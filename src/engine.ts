import {
  BUILDINGS,
  CITY_ACTIONS,
  EMPTY_INVENTORY,
  GAME_CONFIG,
  ROLE_META,
  TILES,
} from "./config";
import {
  BUILDING_KEYS,
  RESOURCE_KEYS,
  ROLE_KEYS,
  type ActionResult,
  type AnalyticsState,
  type AwaySummary,
  type BuildingKey,
  type CityActionKey,
  type GameEvent,
  type GameEventType,
  type GameState,
  type Inventory,
  type Player,
  type ResourceAmount,
  type ResourceKey,
  type RoleKey,
  type Structure,
  type TimeSample,
  type TradeOffer,
  type WorldState,
} from "./types";

const MAX_STAT = 100;
const INITIAL_POPULATION = 24;
const INITIAL_FOOD = 75;
const INITIAL_POWER = 70;
const INITIAL_STABILITY = 80;
const INITIAL_THREAT = 10;
const NPC_OPEN_OFFER_TARGET = 2;
export const GAME_SCHEMA_VERSION = 2;

const NPC_TRADE_TEMPLATES: ReadonlyArray<{
  give: ResourceAmount;
  want: ResourceAmount;
}> = [
  { give: { resource: "tech", amount: 1 }, want: { resource: "materials", amount: 2 } },
  { give: { resource: "supply", amount: 1 }, want: { resource: "water", amount: 1 } },
  { give: { resource: "energy", amount: 1 }, want: { resource: "supply", amount: 1 } },
  { give: { resource: "water", amount: 2 }, want: { resource: "tech", amount: 1 } },
  { give: { resource: "materials", amount: 2 }, want: { resource: "energy", amount: 1 } },
];

function assertTimestamp(now: number): void {
  if (!Number.isFinite(now)) {
    throw new RangeError("Timestamp must be a finite number.");
  }
}

function clamp(value: number, minimum = 0, maximum = MAX_STAT): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function inventory(values: Partial<Inventory> = {}): Inventory {
  return {
    materials: values.materials ?? 0,
    water: values.water ?? 0,
    tech: values.tech ?? 0,
    energy: values.energy ?? 0,
    supply: values.supply ?? 0,
  };
}

function copyInventory(source: Inventory): Inventory {
  return inventory(source);
}

function cloneState(source: GameState): GameState {
  return {
    ...source,
    world: {
      ...source.world,
      activeTileIds: [...source.world.activeTileIds],
      blackout: {
        ...source.world.blackout,
        disabledTileIds: [...source.world.blackout.disabledTileIds],
      },
      structures: source.world.structures.map((structure) => ({ ...structure })),
    },
    players: source.players.map((player) => ({
      ...player,
      inventory: copyInventory(player.inventory),
    })),
    trades: source.trades.map((offer) => ({
      ...offer,
      give: { ...offer.give },
      want: { ...offer.want },
    })),
    events: source.events.map((event) => ({
      ...event,
      data: event.data ? { ...event.data } : undefined,
    })),
    analytics: {
      ...source.analytics,
      resourcesMinted: copyInventory(source.analytics.resourcesMinted),
      resourcesSpent: copyInventory(source.analytics.resourcesSpent),
      firstActionSeconds: [...source.analytics.firstActionSeconds],
      samples: source.analytics.samples.map((sample) => ({ ...sample })),
    },
  };
}

function seedFrom(now: number, civilization: number): number {
  const low = Math.trunc(now) >>> 0;
  const high = Math.trunc(now / 0x1_0000_0000) >>> 0;
  const mixed = (low ^ Math.imul(high, 0x85eb_ca6b) ^ Math.imul(civilization, 0x9e37_79b1)) >>> 0;
  return mixed === 0 ? 0x6d2b_79f5 : mixed;
}

function nextRandom(state: GameState): number {
  const seed = (Math.imul(state.world.rngSeed, 1_664_525) + 1_013_904_223) >>> 0;
  state.world.rngSeed = seed;
  return seed / 0x1_0000_0000;
}

function nextInteger(state: GameState, maximumExclusive: number): number {
  return Math.floor(nextRandom(state) * maximumExclusive);
}

function nextEntityId(state: GameState, prefix: string, at: number, ordinal = 0): string {
  const time = Math.max(0, Math.trunc(at)).toString(36);
  const sequence = (state.world.revision + state.players.length + state.trades.length + ordinal + 1).toString(36);
  return `${prefix}-${state.world.civilization}-${time}-${sequence}`;
}

function emitEvent(
  state: GameState,
  at: number,
  type: GameEventType,
  message: string,
  details: Omit<Partial<GameEvent>, "id" | "at" | "type" | "message" | "configVersion"> = {},
): void {
  state.world.revision += 1;
  state.world.updatedAt = Math.max(state.world.updatedAt, at);
  state.events.push({
    id: `event-${state.world.civilization}-${state.world.revision}`,
    at,
    type,
    message,
    ...details,
    data: details.data ? { ...details.data } : undefined,
    civilization: state.world.civilization,
    configVersion: state.configVersion,
  });
  if (state.events.length > GAME_CONFIG.maxEvents) {
    state.events.splice(0, state.events.length - GAME_CONFIG.maxEvents);
  }
}

function makeWorld(now: number, civilization: number): WorldState {
  return {
    id: `world-${civilization}`,
    civilization,
    revision: 0,
    rngSeed: seedFrom(now, civilization),
    createdAt: now,
    updatedAt: now,
    nextPulseAt: now + GAME_CONFIG.pulseMs,
    nextTickAt: now + GAME_CONFIG.tickMs,
    pulseCount: 0,
    tickCount: 0,
    lastPulseRoll: null,
    activePulseNumber: null,
    activeTileIds: [],
    population: INITIAL_POPULATION,
    populationCap: GAME_CONFIG.basePopulationCap,
    food: INITIAL_FOOD,
    power: INITIAL_POWER,
    stability: INITIAL_STABILITY,
    buildingHealth: MAX_STAT,
    threat: INITIAL_THREAT,
    status: "alive",
    blackout: {
      active: false,
      startedAt: null,
      endsAt: null,
      cooldownUntil: 0,
      district: null,
      disabledTileIds: [],
    },
    structures: [],
  };
}

function makeAnalytics(now: number): AnalyticsState {
  return {
    sessions: 0,
    joins: 0,
    actionAttempts: 0,
    actionSuccesses: 0,
    tradeOffersCreated: 0,
    tradesAccepted: 0,
    blackoutsStarted: 0,
    blackoutsResolved: 0,
    reconnects: 0,
    resourcesMinted: copyInventory(EMPTY_INVENTORY),
    resourcesSpent: copyInventory(EMPTY_INVENTORY),
    firstActionSeconds: [],
    samples: [
      {
        at: now,
        civilization: 1,
        configVersion: GAME_CONFIG.version,
        population: INITIAL_POPULATION,
        food: INITIAL_FOOD,
        power: INITIAL_POWER,
        stability: INITIAL_STABILITY,
        buildingHealth: MAX_STAT,
        players: 0,
      },
    ],
  };
}

function addSample(state: GameState, at: number): void {
  const sample: TimeSample = {
    at,
    civilization: state.world.civilization,
    configVersion: state.configVersion,
    population: state.world.population,
    food: state.world.food,
    power: state.world.power,
    stability: state.world.stability,
    buildingHealth: state.world.buildingHealth,
    players: state.players.length,
  };
  state.analytics.samples.push(sample);
  if (state.analytics.samples.length > GAME_CONFIG.maxSamples) {
    state.analytics.samples.splice(0, state.analytics.samples.length - GAME_CONFIG.maxSamples);
  }
}

function hasInventory(source: Inventory, required: Inventory | ResourceAmount): boolean {
  if ("resource" in required) {
    return source[required.resource] >= required.amount;
  }
  return RESOURCE_KEYS.every((key) => source[key] >= required[key]);
}

function addInventory(target: Inventory, change: Inventory | ResourceAmount): void {
  if ("resource" in change) {
    target[change.resource] += change.amount;
    return;
  }
  for (const key of RESOURCE_KEYS) {
    target[key] += change[key];
  }
}

function subtractInventory(target: Inventory, change: Inventory | ResourceAmount): void {
  if ("resource" in change) {
    target[change.resource] -= change.amount;
    return;
  }
  for (const key of RESOURCE_KEYS) {
    target[key] -= change[key];
  }
}

function recordInventory(target: Inventory, change: Inventory | ResourceAmount): void {
  if ("resource" in change) {
    target[change.resource] += change.amount;
    return;
  }
  for (const key of RESOURCE_KEYS) {
    target[key] += change[key];
  }
}

function inventoryEventData(prefix: string, source: Inventory): Record<string, number> {
  return Object.fromEntries(
    RESOURCE_KEYS.map((resource) => [`${prefix}_${resource}`, source[resource]]),
  );
}

function amountEventData(prefix: string, change: ResourceAmount): Record<string, number | string> {
  return {
    [`${prefix}_resource`]: change.resource,
    [`${prefix}_amount`]: change.amount,
  };
}

function totalInventory(source: Inventory): number {
  return RESOURCE_KEYS.reduce((total, key) => total + source[key], 0);
}

function findPlayer(state: GameState, playerId: string): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

function normalizePlayerName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function chooseHomeTile(state: GameState, role: RoleKey): string {
  const preferredResource = ROLE_META[role].resource;
  const candidates = TILES.filter((tile) => tile.resource === preferredResource);
  const occupancy = new Map<string, number>();
  for (const player of state.players) {
    occupancy.set(player.homeTileId, (occupancy.get(player.homeTileId) ?? 0) + 1);
  }
  return candidates.reduce((best, tile) => {
    const tileCount = occupancy.get(tile.id) ?? 0;
    const bestCount = occupancy.get(best.id) ?? 0;
    return tileCount < bestCount ? tile : best;
  }).id;
}

function isValidResourceAmount(value: ResourceAmount): boolean {
  return (
    RESOURCE_KEYS.includes(value.resource) &&
    Number.isSafeInteger(value.amount) &&
    value.amount > 0
  );
}

function ensureNpcOffers(state: GameState, at: number): void {
  if (state.world.status !== "alive") return;
  const openNpcOffers = state.trades.filter((offer) => offer.npc && offer.status === "open");
  for (let index = openNpcOffers.length; index < NPC_OPEN_OFFER_TARGET; index += 1) {
    const templateIndex = (state.world.civilization + state.world.pulseCount + state.trades.length + index) % NPC_TRADE_TEMPLATES.length;
    const template = NPC_TRADE_TEMPLATES[templateIndex];
    const offerOrdinal = state.trades.length + index;
    const offerId = nextEntityId(state, "npc-offer", at, offerOrdinal);
    const offer: TradeOffer = {
      id: offerId,
      makerId: `maker-${offerId}`,
      makerName: index % 2 === 0 ? "Civic Exchange" : "Relief Convoy",
      give: { ...template.give },
      want: { ...template.want },
      createdAt: at,
      expiresAt: at + GAME_CONFIG.tradeExpiryMs,
      status: "open",
      npc: true,
    };
    state.trades.push(offer);
    state.analytics.tradeOffersCreated += 1;
    emitEvent(state, at, "trade_created", `${offer.makerName} opened a trade offer.`, {
      success: true,
      data: {
        offerId: offer.id,
        npc: true,
        giveResource: offer.give.resource,
        giveAmount: offer.give.amount,
        wantResource: offer.want.resource,
        wantAmount: offer.want.amount,
      },
    });
  }
}

function expireOffers(state: GameState, through: number): void {
  const dueOffers = state.trades
    .filter((offer) => offer.status === "open" && offer.expiresAt <= through)
    .sort((left, right) => left.expiresAt - right.expiresAt || left.createdAt - right.createdAt);
  for (const offer of dueOffers) {
    offer.status = "expired";
    emitEvent(state, offer.expiresAt, "trade_expired", `${offer.makerName}'s trade offer expired.`, {
      actorId: offer.npc ? undefined : offer.makerId,
      data: { offerId: offer.id, npc: offer.npc },
    });
  }
}

function nextOfferExpiry(state: GameState): number {
  return state.trades.reduce(
    (next, offer) => offer.status === "open" ? Math.min(next, offer.expiresAt) : next,
    Number.POSITIVE_INFINITY,
  );
}

function reject(
  state: GameState,
  at: number,
  message: string,
  operation: string,
  actorId?: string,
  countAsAction = false,
): ActionResult {
  if (countAsAction) {
    state.analytics.actionAttempts += 1;
  }
  emitEvent(state, at, "action_rejected", message, {
    actorId,
    success: false,
    reason: message,
    data: { operation, countedAsAction: countAsAction },
  });
  return { state, ok: false, message };
}

function completePlayerAction(state: GameState, player: Player, at: number): void {
  player.completedActions += 1;
  player.contribution += 1;
  player.lastSeenAt = at;
  player.actionReadyAt = at + GAME_CONFIG.actionCooldownMs;
  if (player.firstActionAt === null) {
    player.firstActionAt = at;
    state.analytics.firstActionSeconds.push(Math.max(0, (at - player.joinedAt) / 1_000));
  }
  state.analytics.actionSuccesses += 1;
}

function recalculateWorldStructureStats(state: GameState): void {
  const livingStructures = state.world.structures.filter((structure) => structure.health > 0);
  const shelters = livingStructures.filter((structure) => structure.type === "shelter").length;
  state.world.populationCap = GAME_CONFIG.basePopulationCap + shelters * 25;
  if (state.world.structures.length === 0) {
    state.world.buildingHealth = MAX_STAT;
  } else {
    const totalHealth = state.world.structures.reduce((total, structure) => total + structure.health, 0);
    state.world.buildingHealth = Math.round(totalHealth / state.world.structures.length);
  }
  state.world.population = Math.min(state.world.population, state.world.populationCap);
}

function activeStructures(state: GameState, type: BuildingKey): Structure[] {
  const disabled = new Set(state.world.blackout.disabledTileIds);
  return state.world.structures.filter(
    (structure) => structure.type === type && structure.health > 0 && !disabled.has(structure.tileId),
  );
}

function resolveBlackout(state: GameState, at: number, manual: boolean): void {
  if (!state.world.blackout.active) {
    return;
  }
  const district = state.world.blackout.district ?? "affected district";
  state.world.blackout = {
    ...state.world.blackout,
    active: false,
    startedAt: null,
    endsAt: null,
    district: null,
    disabledTileIds: [],
  };
  state.world.power = clamp(state.world.power + (manual ? 12 : 4));
  state.world.stability = clamp(state.world.stability + (manual ? 6 : 3));
  state.world.threat = clamp(state.world.threat - (manual ? 10 : 4));
  state.analytics.blackoutsResolved += 1;
  emitEvent(state, at, "blackout_resolved", `${district} returned to the grid.`, {
    success: true,
    data: { district, manual },
  });
}

function startBlackout(state: GameState, at: number): void {
  const districts = [...new Set(TILES.map((tile) => tile.district).filter((district) => district !== "Civic Core"))];
  const district = districts[nextInteger(state, districts.length)];
  const disabledTileIds = TILES.filter((tile) => tile.district === district).map((tile) => tile.id);
  const protectedByDefense = activeStructures(state, "defense").length > 0;
  const crisisScale = protectedByDefense ? 0.65 : 1;

  state.world.blackout = {
    active: true,
    startedAt: at,
    endsAt: at + GAME_CONFIG.blackoutDurationMs,
    cooldownUntil: at + GAME_CONFIG.blackoutDurationMs + GAME_CONFIG.blackoutCooldownMs,
    district,
    disabledTileIds,
  };
  state.world.power = clamp(state.world.power - Math.round(12 * crisisScale));
  state.world.stability = clamp(state.world.stability - Math.round(5 * crisisScale));
  state.world.threat = clamp(state.world.threat + Math.round(10 * crisisScale));
  state.analytics.blackoutsStarted += 1;
  emitEvent(state, at, "blackout_started", `${district} lost power.`, {
    data: { district, disabledTiles: disabledTileIds.length, protectedByDefense },
  });
}

function collapseIfNeeded(state: GameState, at: number): void {
  if (state.world.status === "collapsed") {
    return;
  }
  const noLivingStructures =
    state.world.structures.length > 0 && state.world.structures.every((structure) => structure.health <= 0);
  if (
    state.world.population <= 0 ||
    state.world.stability <= 0 ||
    state.world.threat >= MAX_STAT ||
    noLivingStructures
  ) {
    state.world.status = "collapsed";
    state.world.activePulseNumber = null;
    state.world.activeTileIds = [];
    emitEvent(state, at, "civilization_collapsed", "The civilization collapsed. Reset to begin a new era.", {
      success: false,
      data: {
        population: state.world.population,
        stability: state.world.stability,
        threat: state.world.threat,
      },
    });
  }
}

function rollPulse(state: GameState, at: number): void {
  const roll = nextInteger(state, 6) + 1 + nextInteger(state, 6) + 1;
  state.world.pulseCount += 1;
  state.world.lastPulseRoll = roll;
  state.world.activePulseNumber = roll;
  state.world.activeTileIds = [];

  let minted = 0;
  let recipients = 0;
  const mintedByResource = copyInventory(EMPTY_INVENTORY);
  if (roll === 7) {
    if (!state.world.blackout.active && at >= state.world.blackout.cooldownUntil) {
      startBlackout(state, at);
    }
  } else {
    const disabled = new Set(state.world.blackout.disabledTileIds);
    const activeTiles = TILES.filter(
      (tile) => tile.pulseNumber === roll && tile.resource !== null && !disabled.has(tile.id),
    );
    state.world.activeTileIds = activeTiles.map((tile) => tile.id);
    const activeById = new Map(activeTiles.map((tile) => [tile.id, tile]));
    for (const player of state.players) {
      const tile = activeById.get(player.homeTileId);
      if (!tile?.resource) {
        continue;
      }
      player.inventory[tile.resource] += 1;
      state.analytics.resourcesMinted[tile.resource] += 1;
      mintedByResource[tile.resource] += 1;
      minted += 1;
      recipients += 1;
    }
    if (minted > 0) {
      emitEvent(state, at, "resource_minted", `${minted} resources entered player inventories.`, {
        data: {
          roll,
          amount: minted,
          recipients,
          source: "world_pulse",
          ...inventoryEventData("amount", mintedByResource),
        },
      });
    }
  }

  emitEvent(state, at, "pulse_resolved", `World Pulse rolled ${roll}.`, {
    data: {
      roll,
      activeTiles: state.world.activeTileIds.length,
      resourcesMinted: minted,
      blackoutActive: state.world.blackout.active,
    },
  });
  state.world.nextPulseAt += GAME_CONFIG.pulseMs;
  collapseIfNeeded(state, at);
}

function runWorldTick(state: GameState, at: number): void {
  const farms = activeStructures(state, "farm").length;
  const reactors = activeStructures(state, "reactor").length;
  const medbayActive = activeStructures(state, "medbay").length > 0;
  const defenseActive = activeStructures(state, "defense").length > 0;
  const foodDemand = Math.max(2, Math.ceil(state.world.population / 12));
  const powerDemand = Math.max(
    2,
    Math.ceil(state.world.population / 16) + Math.ceil(state.world.structures.length / 3),
  );

  state.world.food = clamp(state.world.food + farms * 7 - foodDemand);
  state.world.power = clamp(
    state.world.power + reactors * 8 - powerDemand - (state.world.blackout.active ? 8 : 0),
  );

  const foodCritical = state.world.food < 20;
  const powerCritical = state.world.power < 20;
  const healthy = state.world.food >= 35 && state.world.power >= 35;
  let stabilityDelta = healthy ? 1 : 0;
  if (foodCritical) stabilityDelta -= 5;
  if (powerCritical) stabilityDelta -= 5;
  if (state.world.blackout.active) stabilityDelta -= 3;
  if (state.world.threat >= 75) stabilityDelta -= 4;
  state.world.stability = clamp(state.world.stability + stabilityDelta);

  let threatDelta = healthy ? -1 : 4;
  if (foodCritical) threatDelta += 4;
  if (powerCritical) threatDelta += 4;
  if (state.world.blackout.active) threatDelta += 6;
  if (defenseActive) threatDelta -= 2;
  state.world.threat = clamp(state.world.threat + threatDelta);

  const populationInDanger = state.world.food < 10 || state.world.power < 10 || state.world.stability < 15;
  if (populationInDanger) {
    let loss = Math.max(1, Math.ceil(state.world.population * 0.05));
    if (medbayActive) loss = Math.max(1, Math.ceil(loss / 2));
    state.world.population = Math.max(0, state.world.population - loss);
  } else if (
    state.world.food > 40 &&
    state.world.power > 40 &&
    state.world.stability > 40 &&
    state.world.population < state.world.populationCap
  ) {
    state.world.population += 1;
  }

  const disabled = new Set(state.world.blackout.disabledTileIds);
  const structuralCrisis = foodCritical || powerCritical || state.world.threat >= 70;
  for (const structure of state.world.structures) {
    let decay = structuralCrisis ? 2 : 0;
    if (state.world.blackout.active && disabled.has(structure.tileId)) decay += 4;
    if (defenseActive) decay = Math.ceil(decay * 0.65);
    structure.health = clamp(structure.health - decay);
  }

  recalculateWorldStructureStats(state);
  state.world.tickCount += 1;
  state.world.nextTickAt += GAME_CONFIG.tickMs;
  emitEvent(state, at, "world_tick", "The persistent world advanced one tick.", {
    data: {
      foodDemand,
      powerDemand,
      farms,
      reactors,
      blackoutActive: state.world.blackout.active,
    },
  });
  addSample(state, at);
  collapseIfNeeded(state, at);
}

function advancePast(scheduleAt: number, interval: number, through: number): number {
  if (scheduleAt > through) {
    return scheduleAt;
  }
  return scheduleAt + (Math.floor((through - scheduleAt) / interval) + 1) * interval;
}

export function createInitialState(now: number): GameState {
  assertTimestamp(now);
  const state: GameState = {
    schemaVersion: GAME_SCHEMA_VERSION,
    configVersion: GAME_CONFIG.version,
    world: makeWorld(now, 1),
    players: [],
    trades: [],
    events: [],
    analytics: makeAnalytics(now),
  };
  emitEvent(state, now, "civilization_started", "Civilization 1 came online.", {
    data: { civilization: 1 },
  });
  ensureNpcOffers(state, now);
  return state;
}

export function joinPlayer(
  source: GameState,
  name: string,
  role: RoleKey,
  now: number,
): ActionResult {
  assertTimestamp(now);
  const state = processDueEvents(source, now);
  const at = state.world.updatedAt;
  const normalizedName = normalizePlayerName(name);
  if (normalizedName.length < 2 || normalizedName.length > 24) {
    return reject(state, at, "Name must contain 2–24 characters.", "join_player");
  }
  if (!ROLE_KEYS.includes(role)) {
    return reject(state, at, "Choose a valid role.", "join_player");
  }

  const startsCivilizationClock = state.players.length === 0 && state.analytics.joins === 0;

  const returning = state.players.find(
    (player) => player.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
  );
  state.analytics.sessions += 1;
  if (returning) {
    returning.lastSeenAt = at;
    state.analytics.reconnects += 1;
    emitEvent(state, at, "player_joined", `${returning.name} reconnected.`, {
      actorId: returning.id,
      success: true,
      data: { reconnect: true, role: returning.role },
    });
    return { state, ok: true, message: `Welcome back, ${returning.name}.` };
  }

  const player: Player = {
    id: nextEntityId(state, "player", at),
    name: normalizedName,
    role,
    homeTileId: chooseHomeTile(state, role),
    inventory: copyInventory(ROLE_META[role].starter),
    contribution: 0,
    joinedAt: at,
    lastSeenAt: at,
    actionReadyAt: at,
    completedActions: 0,
    firstActionAt: null,
  };
  if (startsCivilizationClock) {
    state.world.createdAt = at;
    const baseline = state.analytics.samples[0];
    if (baseline) baseline.at = at;
  }
  state.players.push(player);
  state.analytics.joins += 1;
  recordInventory(state.analytics.resourcesMinted, player.inventory);
  emitEvent(state, at, "player_joined", `${player.name} joined the city.`, {
    actorId: player.id,
    success: true,
    data: { reconnect: false, role, homeTileId: player.homeTileId },
  });
  emitEvent(state, at, "resource_minted", `${player.name} received a specialist starter kit.`, {
    actorId: player.id,
    success: true,
    data: {
      source: "starter_kit",
      role,
      ...inventoryEventData("amount", player.inventory),
    },
  });
  return { state, ok: true, message: `${player.name} joined the city.` };
}

export function processDueEvents(source: GameState, now: number): GameState {
  assertTimestamp(now);
  const state = cloneState(source);
  const requestedThrough = Math.max(now, state.world.updatedAt);
  if (state.world.status === "alive" && state.players.length === 0) {
    state.world.nextPulseAt = requestedThrough + GAME_CONFIG.pulseMs;
    state.world.nextTickAt = requestedThrough + GAME_CONFIG.tickMs;
    for (const offer of state.trades) {
      if (offer.npc && offer.status === "open" && offer.expiresAt <= requestedThrough) {
        offer.expiresAt = requestedThrough + GAME_CONFIG.tradeExpiryMs;
      }
    }
    state.world.updatedAt = requestedThrough;
    return state;
  }
  const simulationThrough = Math.min(
    requestedThrough,
    state.world.updatedAt + GAME_CONFIG.maxOfflineMs,
  );

  let safety = 0;
  while (state.world.status === "alive") {
    const blackoutEnd = state.world.blackout.active
      ? (state.world.blackout.endsAt ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
    const offerExpiry = nextOfferExpiry(state);
    const nextAt = Math.min(state.world.nextPulseAt, state.world.nextTickAt, blackoutEnd, offerExpiry);
    if (nextAt > simulationThrough) {
      break;
    }
    safety += 1;
    if (safety > 10_000) {
      throw new Error("Scheduled-event safety limit exceeded.");
    }

    if (
      offerExpiry <= blackoutEnd
      && offerExpiry <= state.world.nextPulseAt
      && offerExpiry <= state.world.nextTickAt
    ) {
      expireOffers(state, offerExpiry);
      ensureNpcOffers(state, offerExpiry);
    } else if (blackoutEnd <= state.world.nextPulseAt && blackoutEnd <= state.world.nextTickAt) {
      resolveBlackout(state, blackoutEnd, false);
    } else if (state.world.nextPulseAt <= state.world.nextTickAt) {
      rollPulse(state, state.world.nextPulseAt);
    } else {
      runWorldTick(state, state.world.nextTickAt);
    }
  }

  if (state.world.blackout.active && (state.world.blackout.endsAt ?? Number.POSITIVE_INFINITY) <= requestedThrough) {
    resolveBlackout(state, state.world.blackout.endsAt ?? requestedThrough, false);
  }
  if (requestedThrough > simulationThrough || state.world.status === "collapsed") {
    state.world.nextPulseAt = advancePast(state.world.nextPulseAt, GAME_CONFIG.pulseMs, requestedThrough);
    state.world.nextTickAt = advancePast(state.world.nextTickAt, GAME_CONFIG.tickMs, requestedThrough);
  }

  expireOffers(state, requestedThrough);
  ensureNpcOffers(state, requestedThrough);
  state.world.updatedAt = requestedThrough;
  return state;
}

export function buildStructure(
  source: GameState,
  playerId: string,
  type: BuildingKey,
  tileId: string,
  now: number,
): ActionResult {
  assertTimestamp(now);
  const state = processDueEvents(source, now);
  const at = state.world.updatedAt;
  const player = findPlayer(state, playerId);
  if (!player) return reject(state, at, "Player not found.", "build_structure", playerId, true);
  if (state.world.status !== "alive") {
    return reject(state, at, "The civilization has collapsed.", "build_structure", playerId, true);
  }
  if (!BUILDING_KEYS.includes(type)) {
    return reject(state, at, "Unknown building type.", "build_structure", playerId, true);
  }
  if (player.actionReadyAt > at) {
    return reject(state, at, "City action is still cooling down.", "build_structure", playerId, true);
  }
  const tile = TILES.find((candidate) => candidate.id === tileId);
  if (!tile || tile.resource === null) {
    return reject(state, at, "Choose a producing city tile.", "build_structure", playerId, true);
  }
  if (state.world.structures.some((structure) => structure.tileId === tileId)) {
    return reject(state, at, "That tile already contains a structure.", "build_structure", playerId, true);
  }
  const definition = BUILDINGS[type];
  if (!hasInventory(player.inventory, definition.cost)) {
    return reject(state, at, "Insufficient resources for this building.", "build_structure", playerId, true);
  }

  state.analytics.actionAttempts += 1;
  subtractInventory(player.inventory, definition.cost);
  recordInventory(state.analytics.resourcesSpent, definition.cost);
  emitEvent(state, at, "resource_spent", `${player.name} committed resources to construction.`, {
    actorId: player.id,
    success: true,
    data: {
      source: "build_structure",
      buildingType: type,
      ...inventoryEventData("amount", definition.cost),
    },
  });
  const structure: Structure = {
    id: nextEntityId(state, "structure", at, state.world.structures.length),
    type,
    tileId,
    health: MAX_STAT,
    level: 1,
    builtAt: at,
    builtBy: player.id,
  };
  state.world.structures.push(structure);
  player.contribution += totalInventory(definition.cost);
  completePlayerAction(state, player, at);
  recalculateWorldStructureStats(state);
  emitEvent(state, at, "building_built", `${player.name} built ${definition.label}.`, {
    actorId: player.id,
    success: true,
    data: { buildingType: type, structureId: structure.id, tileId },
  });
  emitEvent(state, at, "action_succeeded", `${definition.label} is operational.`, {
    actorId: player.id,
    success: true,
    data: {
      operation: "build_structure",
      buildingType: type,
      countedAsAction: true,
      ...inventoryEventData("cost", definition.cost),
    },
  });
  return { state, ok: true, message: `${definition.label} built.` };
}

export function performCityAction(
  source: GameState,
  playerId: string,
  action: CityActionKey,
  now: number,
): ActionResult {
  assertTimestamp(now);
  const state = processDueEvents(source, now);
  const at = state.world.updatedAt;
  const player = findPlayer(state, playerId);
  if (!player) return reject(state, at, "Player not found.", "city_action", playerId, true);
  if (state.world.status !== "alive") {
    return reject(state, at, "The civilization has collapsed.", "city_action", playerId, true);
  }
  if (!(action in CITY_ACTIONS)) {
    return reject(state, at, "Unknown city action.", "city_action", playerId, true);
  }
  if (player.actionReadyAt > at) {
    return reject(state, at, "City action is still cooling down.", "city_action", playerId, true);
  }
  if (action === "restore_grid" && !state.world.blackout.active) {
    return reject(state, at, "There is no active Blackout.", "city_action", playerId, true);
  }
  if (action === "repair") {
    const damaged = state.world.structures.some((structure) => structure.health < MAX_STAT);
    if (!damaged) {
      return reject(state, at, "No structure currently needs repair.", "city_action", playerId, true);
    }
  }

  const definition = CITY_ACTIONS[action];
  if (!hasInventory(player.inventory, definition.cost)) {
    return reject(state, at, "Insufficient resources for this action.", "city_action", playerId, true);
  }

  state.analytics.actionAttempts += 1;
  subtractInventory(player.inventory, definition.cost);
  recordInventory(state.analytics.resourcesSpent, definition.cost);
  emitEvent(state, at, "resource_spent", `${player.name} committed resources to a city action.`, {
    actorId: player.id,
    success: true,
    data: {
      source: "city_action",
      action,
      ...inventoryEventData("amount", definition.cost),
    },
  });
  switch (action) {
    case "feed":
      state.world.food = clamp(state.world.food + 22);
      state.world.stability = clamp(state.world.stability + 2);
      break;
    case "power":
      state.world.power = clamp(state.world.power + 22);
      state.world.threat = clamp(state.world.threat - 6);
      break;
    case "repair": {
      const weakest = [...state.world.structures]
        .filter((structure) => structure.health < MAX_STAT)
        .sort((left, right) => left.health - right.health || left.builtAt - right.builtAt)[0];
      weakest.health = clamp(weakest.health + 28);
      recalculateWorldStructureStats(state);
      break;
    }
    case "stabilize":
      state.world.stability = clamp(state.world.stability + 15);
      state.world.food = clamp(state.world.food + 5);
      break;
    case "restore_grid":
      resolveBlackout(state, at, true);
      break;
  }

  player.contribution += totalInventory(definition.cost);
  completePlayerAction(state, player, at);
  emitEvent(state, at, "action_succeeded", `${player.name}: ${definition.label}.`, {
    actorId: player.id,
    success: true,
    data: {
      operation: "city_action",
      action,
      countedAsAction: true,
      ...inventoryEventData("cost", definition.cost),
    },
  });
  return { state, ok: true, message: `${definition.label} completed.` };
}

export function createTradeOffer(
  source: GameState,
  playerId: string,
  give: ResourceAmount,
  want: ResourceAmount,
  now: number,
): ActionResult {
  assertTimestamp(now);
  const state = processDueEvents(source, now);
  const at = state.world.updatedAt;
  const player = findPlayer(state, playerId);
  if (!player) return reject(state, at, "Player not found.", "create_trade", playerId);
  if (state.world.status !== "alive") {
    return reject(state, at, "The civilization has collapsed.", "create_trade", playerId);
  }
  if (!isValidResourceAmount(give) || !isValidResourceAmount(want)) {
    return reject(state, at, "Trade amounts must be positive whole numbers.", "create_trade", playerId);
  }
  if (give.resource === want.resource) {
    return reject(state, at, "A trade must exchange different resources.", "create_trade", playerId);
  }
  if (state.trades.some((offer) => !offer.npc && offer.makerId === playerId && offer.status === "open")) {
    return reject(state, at, "You already have an open trade offer.", "create_trade", playerId);
  }
  if (!hasInventory(player.inventory, give)) {
    return reject(state, at, "Insufficient resources for this offer.", "create_trade", playerId);
  }

  const offer: TradeOffer = {
    id: nextEntityId(state, "offer", at),
    makerId: player.id,
    makerName: player.name,
    give: { ...give },
    want: { ...want },
    createdAt: at,
    expiresAt: at + GAME_CONFIG.tradeExpiryMs,
    status: "open",
    npc: false,
  };
  state.trades.push(offer);
  player.lastSeenAt = at;
  state.analytics.tradeOffersCreated += 1;
  emitEvent(state, at, "trade_created", `${player.name} opened a trade offer.`, {
    actorId: player.id,
    success: true,
    data: {
      offerId: offer.id,
      giveResource: give.resource,
      giveAmount: give.amount,
      wantResource: want.resource,
      wantAmount: want.amount,
    },
  });
  return { state, ok: true, message: "Trade offer created." };
}

export function acceptTradeOffer(
  source: GameState,
  playerId: string,
  offerId: string,
  now: number,
): ActionResult {
  assertTimestamp(now);
  const state = processDueEvents(source, now);
  const at = state.world.updatedAt;
  const buyer = findPlayer(state, playerId);
  if (!buyer) return reject(state, at, "Player not found.", "accept_trade", playerId);
  if (state.world.status !== "alive") {
    return reject(state, at, "The civilization has collapsed.", "accept_trade", playerId);
  }
  const offer = state.trades.find((candidate) => candidate.id === offerId);
  if (!offer || offer.status !== "open") {
    return reject(state, at, "This trade offer is no longer available.", "accept_trade", playerId);
  }
  if (!offer.npc && offer.makerId === playerId) {
    return reject(state, at, "You cannot accept your own offer.", "accept_trade", playerId);
  }
  if (!hasInventory(buyer.inventory, offer.want)) {
    return reject(state, at, "You do not have the requested resources.", "accept_trade", playerId);
  }

  if (offer.npc) {
    subtractInventory(buyer.inventory, offer.want);
    addInventory(buyer.inventory, offer.give);
    recordInventory(state.analytics.resourcesSpent, offer.want);
    recordInventory(state.analytics.resourcesMinted, offer.give);
    emitEvent(state, at, "resource_spent", `${buyer.name} supplied the autonomous market.`, {
      actorId: buyer.id,
      success: true,
      data: {
        source: "npc_trade",
        offerId: offer.id,
        ...amountEventData("amount", offer.want),
      },
    });
    emitEvent(state, at, "resource_minted", `${buyer.name} received an autonomous-market resource.`, {
      actorId: buyer.id,
      success: true,
      data: {
        source: "npc_trade",
        offerId: offer.id,
        ...amountEventData("amount", offer.give),
      },
    });
  } else {
    const maker = findPlayer(state, offer.makerId);
    if (!maker || !hasInventory(maker.inventory, offer.give)) {
      return reject(state, at, "The maker no longer has the offered resources.", "accept_trade", playerId);
    }
    subtractInventory(maker.inventory, offer.give);
    addInventory(maker.inventory, offer.want);
    subtractInventory(buyer.inventory, offer.want);
    addInventory(buyer.inventory, offer.give);
    maker.lastSeenAt = at;
  }

  buyer.lastSeenAt = at;
  offer.status = "accepted";
  offer.acceptedBy = buyer.id;
  state.analytics.tradesAccepted += 1;
  emitEvent(state, at, "trade_accepted", `${buyer.name} accepted ${offer.makerName}'s offer.`, {
    actorId: buyer.id,
    success: true,
    data: { offerId: offer.id, makerId: offer.makerId, npc: offer.npc },
  });
  if (offer.npc) ensureNpcOffers(state, at);
  return { state, ok: true, message: "Trade completed." };
}

export function cancelTradeOffer(
  source: GameState,
  playerId: string,
  offerId: string,
  now: number,
): ActionResult {
  assertTimestamp(now);
  const state = processDueEvents(source, now);
  const at = state.world.updatedAt;
  const player = findPlayer(state, playerId);
  if (!player) return reject(state, at, "Player not found.", "cancel_trade", playerId);
  const offer = state.trades.find((candidate) => candidate.id === offerId);
  if (!offer || offer.status !== "open") {
    return reject(state, at, "This trade offer is no longer available.", "cancel_trade", playerId);
  }
  if (offer.npc || offer.makerId !== playerId) {
    return reject(state, at, "Only the maker can cancel this offer.", "cancel_trade", playerId);
  }
  offer.status = "cancelled";
  player.lastSeenAt = at;
  emitEvent(state, at, "action_succeeded", `${player.name} cancelled a trade offer.`, {
    actorId: player.id,
    success: true,
    data: { operation: "cancel_trade", offerId, countedAsAction: false },
  });
  return { state, ok: true, message: "Trade offer cancelled." };
}

export function resetCivilization(source: GameState, now: number): GameState {
  assertTimestamp(now);
  const state = cloneState(source);
  const at = Math.max(now, state.world.updatedAt);
  const nextCivilization = state.world.civilization + 1;
  const discarded = state.players.reduce((total, player) => {
    addInventory(total, player.inventory);
    return total;
  }, copyInventory(EMPTY_INVENTORY));
  if (totalInventory(discarded) > 0) {
    recordInventory(state.analytics.resourcesSpent, discarded);
    emitEvent(state, at, "resource_spent", "Unspent inventory was retired with the old civilization.", {
      success: true,
      data: {
        source: "civilization_reset",
        ...inventoryEventData("amount", discarded),
      },
    });
  }
  state.world = makeWorld(at, nextCivilization);
  state.players = state.players.map((player) => ({
    ...player,
    inventory: copyInventory(ROLE_META[player.role].starter),
    contribution: 0,
    lastSeenAt: at,
    actionReadyAt: at,
    completedActions: 0,
  }));
  state.trades = [];
  state.configVersion = GAME_CONFIG.version;
  emitEvent(state, at, "civilization_started", `Civilization ${nextCivilization} came online.`, {
    data: { civilization: nextCivilization },
  });
  const starterGrants = state.players.reduce((total, player) => {
    addInventory(total, player.inventory);
    return total;
  }, copyInventory(EMPTY_INVENTORY));
  if (totalInventory(starterGrants) > 0) {
    recordInventory(state.analytics.resourcesMinted, starterGrants);
    emitEvent(state, at, "resource_minted", "Returning citizens received fresh specialist kits.", {
      success: true,
      data: {
        source: "civilization_reset",
        ...inventoryEventData("amount", starterGrants),
      },
    });
  }
  ensureNpcOffers(state, at);
  addSample(state, at);
  return state;
}

function nonNegativeDelta(after: number, before: number): number {
  return Math.max(0, after - before);
}

export function deriveAwaySummary(before: GameState, after: GameState, since: number): AwaySummary {
  assertTimestamp(since);
  const resetOccurred = after.world.civilization !== before.world.civilization;
  const countSince = (type: GameEventType): number =>
    after.events.filter((event) => event.type === type && event.at > since).length;
  return {
    since,
    elapsedMs: Math.max(0, after.world.updatedAt - since),
    pulses: resetOccurred
      ? countSince("pulse_resolved")
      : nonNegativeDelta(after.world.pulseCount, before.world.pulseCount),
    ticks: resetOccurred
      ? countSince("world_tick")
      : nonNegativeDelta(after.world.tickCount, before.world.tickCount),
    trades: nonNegativeDelta(after.analytics.tradesAccepted, before.analytics.tradesAccepted),
    blackouts: nonNegativeDelta(after.analytics.blackoutsStarted, before.analytics.blackoutsStarted),
    structures: Math.max(
      countSince("building_built"),
      nonNegativeDelta(after.world.structures.length, before.world.structures.length),
    ),
    populationBefore: before.world.population,
    populationAfter: after.world.population,
  };
}
