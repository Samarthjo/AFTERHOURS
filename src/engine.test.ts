import { describe, expect, it } from "vitest";

import { BUILDINGS, GAME_CONFIG, ROLE_META, TILES } from "./config";
import {
  acceptTradeOffer,
  buildStructure,
  cancelTradeOffer,
  createInitialState,
  createTradeOffer,
  deriveAwaySummary,
  joinPlayer,
  performCityAction,
  processDueEvents,
  resetCivilization,
} from "./engine";
import type { GameState, Player, ResourceAmount } from "./types";

const START = 1_000_000;

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function joined(
  name = "Ada",
  role: Parameters<typeof joinPlayer>[2] = "builder",
  now = START,
): { state: GameState; player: Player } {
  const result = joinPlayer(createInitialState(now), name, role, now);
  expect(result.ok).toBe(true);
  return { state: result.state, player: result.state.players[0] };
}

function stateWithNextRoll(source: GameState, wantedRoll: number): GameState {
  for (let seed = 1; seed <= 10_000; seed += 1) {
    const candidate = clone(source);
    candidate.world.rngSeed = seed;
    const resolved = processDueEvents(candidate, candidate.world.nextPulseAt);
    if (resolved.world.lastPulseRoll === wantedRoll) {
      candidate.world.rngSeed = seed;
      return candidate;
    }
  }
  throw new Error(`Could not find deterministic seed for roll ${wantedRoll}`);
}

describe("initialization and scheduled simulation", () => {
  it("creates a deterministic world with an initial event and NPC market", () => {
    const first = createInitialState(START);
    const second = createInitialState(START);

    expect(first).toEqual(second);
    expect(first.configVersion).toBe(GAME_CONFIG.version);
    expect(first.world).toMatchObject({
      civilization: 1,
      status: "alive",
      population: 24,
      populationCap: GAME_CONFIG.basePopulationCap,
      nextPulseAt: START + GAME_CONFIG.pulseMs,
      nextTickAt: START + GAME_CONFIG.tickMs,
    });
    expect(first.events.map((event) => event.type)).toContain("civilization_started");
    expect(first.trades.filter((offer) => offer.npc && offer.status === "open")).toHaveLength(2);
    expect(first.analytics.tradeOffersCreated).toBe(2);
    expect(first.events.every((event) => event.civilization === 1)).toBe(true);
    expect(first.analytics.samples).toHaveLength(1);
    expect(first.analytics.samples[0]).toMatchObject({ civilization: 1, configVersion: GAME_CONFIG.version });
  });

  it("processes pulses and ticks in chronological order without mutating its input", () => {
    const initial = joined("Timer", "builder").state;
    const original = clone(initial);
    const after = processDueEvents(initial, START + 60_000);
    const repeated = processDueEvents(initial, START + 60_000);

    expect(initial).toEqual(original);
    expect(after).toEqual(repeated);
    expect(after.world.pulseCount).toBe(4);
    expect(after.world.tickCount).toBe(3);
    expect(after.world.updatedAt).toBe(START + 60_000);
    expect(after.analytics.samples.at(-1)?.at).toBe(START + 60_000);
  });

  it("keeps an empty civilization paused until its first citizen joins", () => {
    const initial = createInitialState(START);
    const muchLater = START + 24 * 60 * 60 * 1_000;
    const waiting = processDueEvents(initial, muchLater);

    expect(waiting.world).toMatchObject({ status: "alive", pulseCount: 0, tickCount: 0 });
    expect(waiting.world.nextPulseAt).toBe(muchLater + GAME_CONFIG.pulseMs);
    expect(waiting.world.nextTickAt).toBe(muchLater + GAME_CONFIG.tickMs);
    expect(waiting.analytics.tradeOffersCreated).toBe(2);
    expect(waiting.trades.filter((offer) => offer.npc && offer.status === "open")).toHaveLength(2);

    const firstJoin = joinPlayer(waiting, "First", "builder", muchLater);
    expect(firstJoin.state.world.createdAt).toBe(muchLater);
    expect(firstJoin.state.analytics.samples[0].at).toBe(muchLater);
  });

  it("mints a resource to players assigned to a matching home tile", () => {
    const { state, player } = joined("Mina", "builder");
    const home = TILES.find((tile) => tile.id === player.homeTileId);
    expect(home?.pulseNumber).not.toBeNull();
    const seeded = stateWithNextRoll(state, home?.pulseNumber ?? 5);
    const beforeMaterials = seeded.players[0].inventory.materials;
    const beforeMinted = seeded.analytics.resourcesMinted.materials;
    const after = processDueEvents(seeded, seeded.world.nextPulseAt);

    expect(after.players[0].inventory.materials).toBe(beforeMaterials + 1);
    expect(after.analytics.resourcesMinted.materials).toBe(beforeMinted + 1);
    expect(after.world.activeTileIds).toContain(player.homeTileId);
    expect(after.events.some((event) => event.type === "resource_minted")).toBe(true);
  });

  it("starts and automatically resolves deterministic blackouts", () => {
    const initial = joined("Blackout", "operator").state;
    const seeded = stateWithNextRoll(initial, 7);
    const during = processDueEvents(seeded, seeded.world.nextPulseAt);

    expect(during.world.blackout.active).toBe(true);
    expect(during.world.blackout.district).not.toBeNull();
    expect(during.world.blackout.disabledTileIds.length).toBeGreaterThan(0);
    expect(during.analytics.blackoutsStarted).toBe(1);

    const endsAt = during.world.blackout.endsAt;
    expect(endsAt).not.toBeNull();
    const after = processDueEvents(during, endsAt ?? START);
    expect(after.world.blackout.active).toBe(false);
    expect(after.analytics.blackoutsResolved).toBe(1);
    expect(after.events.some((event) => event.type === "blackout_resolved")).toBe(true);
  });

  it("caps long offline simulation and advances schedules beyond the requested time", () => {
    const initial = joined("Offline", "builder").state;
    const requested = START + GAME_CONFIG.maxOfflineMs * 2;
    const after = processDueEvents(initial, requested);

    expect(after.world.pulseCount).toBeLessThanOrEqual(GAME_CONFIG.maxOfflineMs / GAME_CONFIG.pulseMs);
    expect(after.world.tickCount).toBeLessThanOrEqual(GAME_CONFIG.maxOfflineMs / GAME_CONFIG.tickMs);
    expect(after.world.nextPulseAt).toBeGreaterThan(requested);
    expect(after.world.nextTickAt).toBeGreaterThan(requested);
    expect(after.world.updatedAt).toBe(requested);
    expect(initial.world.pulseCount).toBe(0);
  });

  it("keeps scheduled event timestamps in chronological order", () => {
    const after = processDueEvents(joined("Timeline", "builder").state, START + 180_000);
    expect(
      after.events.every((event, index, events) => index === 0 || event.at >= events[index - 1].at),
    ).toBe(true);
  });

  it("collapses a world whose crisis reaches the terminal threshold", () => {
    const crisis = joined("Crisis", "medic").state;
    crisis.world.food = 0;
    crisis.world.power = 0;
    crisis.world.stability = 1;
    crisis.world.threat = 99;

    const after = processDueEvents(crisis, crisis.world.nextTickAt);
    expect(after.world.status).toBe("collapsed");
    expect(after.events.at(-1)?.type).toBe("civilization_collapsed");
  });

  it("expires but does not replenish NPC offers after collapse", () => {
    const crisis = joined("Expiry", "medic").state;
    crisis.world.food = 0;
    crisis.world.power = 0;
    crisis.world.stability = 1;
    crisis.world.threat = 99;
    const collapsed = processDueEvents(crisis, crisis.world.nextTickAt);
    const afterExpiry = processDueEvents(collapsed, START + GAME_CONFIG.tradeExpiryMs + 1);

    expect(afterExpiry.world.status).toBe("collapsed");
    expect(afterExpiry.trades.filter((offer) => offer.npc && offer.status === "open")).toHaveLength(0);
    expect(afterExpiry.analytics.tradeOffersCreated).toBe(2);
  });
});

describe("joining and identity", () => {
  it("normalizes names, assigns a role-matching tile, and copies the starter kit", () => {
    const result = joinPlayer(createInitialState(START), "  Ada   Lovelace ", "engineer", START);
    const player = result.state.players[0];

    expect(result.ok).toBe(true);
    expect(player.name).toBe("Ada Lovelace");
    expect(player.inventory).toEqual(ROLE_META.engineer.starter);
    expect(TILES.find((tile) => tile.id === player.homeTileId)?.resource).toBe("tech");
    expect(result.state.analytics).toMatchObject({ joins: 1, sessions: 1 });
  });

  it("treats a case-insensitive repeat name as a reconnect", () => {
    const first = joinPlayer(createInitialState(START), "Nora", "medic", START);
    const originalId = first.state.players[0].id;
    const second = joinPlayer(first.state, " nORA ", "builder", START + 1_000);

    expect(second.ok).toBe(true);
    expect(second.state.players).toHaveLength(1);
    expect(second.state.players[0]).toMatchObject({ id: originalId, role: "medic" });
    expect(second.state.analytics).toMatchObject({ joins: 1, sessions: 2, reconnects: 1 });
  });

  it("rejects invalid names without changing the source", () => {
    const initial = createInitialState(START);
    const result = joinPlayer(initial, " ", "builder", START);

    expect(result.ok).toBe(false);
    expect(result.state.players).toHaveLength(0);
    expect(initial.events).toHaveLength(3);
    expect(result.state.events.at(-1)?.type).toBe("action_rejected");
  });
});

describe("buildings and city actions", () => {
  it("builds immutably, spends the configured cost, and starts cooldown", () => {
    const { state, player } = joined("Ravi", "builder");
    const before = clone(state);
    const result = buildStructure(state, player.id, "shelter", "t01", START);
    const updatedPlayer = result.state.players[0];

    expect(result.ok).toBe(true);
    expect(state).toEqual(before);
    expect(result.state.world.structures).toHaveLength(1);
    expect(result.state.world.populationCap).toBe(GAME_CONFIG.basePopulationCap + 25);
    expect(updatedPlayer.inventory.materials).toBe(
      ROLE_META.builder.starter.materials - BUILDINGS.shelter.cost.materials,
    );
    expect(updatedPlayer.actionReadyAt).toBe(START + GAME_CONFIG.actionCooldownMs);
    expect(updatedPlayer.firstActionAt).toBe(START);
    expect(result.state.analytics).toMatchObject({ actionAttempts: 1, actionSuccesses: 1 });

    const cooledDown = buildStructure(result.state, player.id, "farm", "t02", START + 1);
    expect(cooledDown.ok).toBe(false);
    expect(cooledDown.state.world.structures).toHaveLength(1);
    expect(cooledDown.state.analytics.actionAttempts).toBe(2);
  });

  it("applies farm production on subsequent world ticks", () => {
    const { state, player } = joined("Ira", "grower");
    const built = buildStructure(state, player.id, "farm", "t04", START);
    expect(built.ok).toBe(true);

    const afterTick = processDueEvents(built.state, START + GAME_CONFIG.tickMs);
    expect(afterTick.world.food).toBe(80);
  });

  it("applies city-action effects and records resource spending", () => {
    const { state, player } = joined("Omar", "operator");
    state.world.power = 50;
    state.world.threat = 20;
    const originalEnergy = state.players[0].inventory.energy;

    const result = performCityAction(state, player.id, "power", START);
    expect(result.ok).toBe(true);
    expect(result.state.world.power).toBe(72);
    expect(result.state.world.threat).toBe(14);
    expect(result.state.players[0].inventory.energy).toBe(originalEnergy - 1);
    expect(result.state.analytics.resourcesSpent.energy).toBe(1);
  });

  it("repairs the weakest damaged structure and rejects a repair when none is needed", () => {
    const { state, player } = joined("Bea", "builder");
    const built = buildStructure(state, player.id, "shelter", "t01", START);
    const damaged = clone(built.state);
    damaged.world.structures[0].health = 40;
    damaged.players[0].actionReadyAt = START;
    damaged.players[0].inventory.materials += 1;
    damaged.players[0].inventory.tech += 1;

    const repaired = performCityAction(damaged, player.id, "repair", START);
    expect(repaired.ok).toBe(true);
    expect(repaired.state.world.structures[0].health).toBe(68);

    const healthy = clone(damaged);
    healthy.world.structures[0].health = 100;
    const rejected = performCityAction(healthy, player.id, "repair", START);
    expect(rejected.ok).toBe(false);
  });

  it("lets a prepared player resolve a blackout early", () => {
    const { state, player } = joined("Uma", "operator");
    const seeded = stateWithNextRoll(state, 7);
    const during = processDueEvents(seeded, seeded.world.nextPulseAt);
    const actionAt = during.world.updatedAt;
    const result = performCityAction(during, player.id, "restore_grid", actionAt);

    expect(result.ok).toBe(true);
    expect(result.state.world.blackout.active).toBe(false);
    expect(result.state.analytics.blackoutsResolved).toBe(1);
    expect(result.state.players[0].inventory).toMatchObject({ tech: 0, energy: 1 });
  });
});

describe("trade market", () => {
  const give: ResourceAmount = { resource: "materials", amount: 1 };
  const want: ResourceAmount = { resource: "water", amount: 1 };

  function twoPlayers(): { state: GameState; makerId: string; buyerId: string } {
    const first = joinPlayer(createInitialState(START), "Maker", "builder", START);
    const second = joinPlayer(first.state, "Buyer", "grower", START);
    return {
      state: second.state,
      makerId: second.state.players[0].id,
      buyerId: second.state.players[1].id,
    };
  }

  it("creates one offer per player and atomically exchanges inventories", () => {
    const { state, makerId, buyerId } = twoPlayers();
    const created = createTradeOffer(state, makerId, give, want, START);
    const offer = created.state.trades.find((candidate) => !candidate.npc);
    expect(created.ok).toBe(true);
    expect(offer).toBeDefined();
    expect(created.state.analytics.tradeOffersCreated).toBe(3);

    const duplicate = createTradeOffer(created.state, makerId, give, want, START);
    expect(duplicate.ok).toBe(false);

    const accepted = acceptTradeOffer(created.state, buyerId, offer?.id ?? "", START);
    expect(accepted.ok).toBe(true);
    expect(accepted.state.trades.find((candidate) => candidate.id === offer?.id)?.status).toBe("accepted");
    expect(accepted.state.players.find((player) => player.id === makerId)?.inventory).toMatchObject({
      materials: 2,
      water: 2,
    });
    expect(accepted.state.players.find((player) => player.id === buyerId)?.inventory).toMatchObject({
      materials: 2,
      water: 2,
    });
    expect(created.state.players.find((player) => player.id === makerId)?.inventory.materials).toBe(3);
    expect(accepted.state.analytics.tradesAccepted).toBe(1);
  });

  it("rejects self-acceptance and stale offers without partial transfers", () => {
    const { state, makerId, buyerId } = twoPlayers();
    const created = createTradeOffer(state, makerId, give, want, START);
    const offerId = created.state.trades.find((offer) => !offer.npc)?.id ?? "";
    expect(acceptTradeOffer(created.state, makerId, offerId, START).ok).toBe(false);

    const stale = clone(created.state);
    const maker = stale.players.find((player) => player.id === makerId);
    if (maker) maker.inventory.materials = 0;
    const buyerBefore = clone(stale).players.find((player) => player.id === buyerId)?.inventory;
    const result = acceptTradeOffer(stale, buyerId, offerId, START);
    expect(result.ok).toBe(false);
    expect(result.state.players.find((player) => player.id === buyerId)?.inventory).toEqual(buyerBefore);
    expect(result.state.trades.find((offer) => offer.id === offerId)?.status).toBe("open");
  });

  it("supports maker cancellation and scheduled expiry", () => {
    const { state, makerId } = twoPlayers();
    const first = createTradeOffer(state, makerId, give, want, START);
    const firstId = first.state.trades.find((offer) => !offer.npc)?.id ?? "";
    const cancelled = cancelTradeOffer(first.state, makerId, firstId, START);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.trades.find((offer) => offer.id === firstId)?.status).toBe("cancelled");

    const second = createTradeOffer(cancelled.state, makerId, give, want, START + 1);
    const secondOffer = second.state.trades.find((offer) => !offer.npc && offer.status === "open");
    const expired = processDueEvents(second.state, (secondOffer?.expiresAt ?? START) + 1);
    expect(expired.trades.find((offer) => offer.id === secondOffer?.id)?.status).toBe("expired");
    expect(expired.events.some((event) => event.type === "trade_expired")).toBe(true);
  });

  it("accepts an NPC offer as a resource sink/source and replenishes the market", () => {
    const { state, player } = joined("Gita", "grower");
    const offer = state.trades.find(
      (candidate) => candidate.npc && candidate.status === "open" && candidate.want.resource === "water",
    );
    expect(offer).toBeDefined();
    const before = clone(state).players[0].inventory;

    const accepted = acceptTradeOffer(state, player.id, offer?.id ?? "", START);
    expect(accepted.ok).toBe(true);
    expect(accepted.state.players[0].inventory.water).toBe(before.water - (offer?.want.amount ?? 0));
    expect(accepted.state.players[0].inventory[offer?.give.resource ?? "supply"]).toBe(
      before[offer?.give.resource ?? "supply"] + (offer?.give.amount ?? 0),
    );
    expect(accepted.state.trades.filter((candidate) => candidate.npc && candidate.status === "open")).toHaveLength(2);
    expect(new Set(
      accepted.state.trades
        .filter((candidate) => candidate.npc && candidate.status === "open")
        .map((candidate) => candidate.makerId),
    ).size).toBe(2);
    expect(accepted.state.analytics).toMatchObject({ tradesAccepted: 1, tradeOffersCreated: 3 });
    expect(accepted.state.events.some((event) => event.type === "resource_spent")).toBe(true);
  });
});

describe("civilization lifecycle and return summary", () => {
  it("resets into a new civilization while preserving player identities", () => {
    const { state, player } = joined("Kai", "builder");
    const built = buildStructure(state, player.id, "shelter", "t01", START);
    const reset = resetCivilization(built.state, START + 5_000);

    expect(reset.world).toMatchObject({ civilization: 2, status: "alive", pulseCount: 0, tickCount: 0 });
    expect(reset.world.structures).toHaveLength(0);
    expect(reset.players).toHaveLength(1);
    expect(reset.players[0]).toMatchObject({ id: player.id, completedActions: 0, firstActionAt: START });
    expect(reset.players[0].inventory).toEqual(ROLE_META.builder.starter);
    expect(reset.trades.filter((offer) => offer.npc && offer.status === "open")).toHaveLength(2);
    expect(reset.analytics.firstActionSeconds).toHaveLength(1);
    expect(reset.analytics.samples.at(-1)).toMatchObject({ civilization: 2, configVersion: GAME_CONFIG.version });
    expect(built.state.world.civilization).toBe(1);
  });

  it("keeps lifetime economy sources and sinks reconciled with current player stock", () => {
    const { state, player } = joined("Mara", "builder");
    const built = buildStructure(state, player.id, "shelter", "t01", START);
    const reset = resetCivilization(built.state, START + 5_000);

    for (const resource of ["materials", "water", "tech", "energy", "supply"] as const) {
      const stock = reset.players.reduce((sum, citizen) => sum + citizen.inventory[resource], 0);
      expect(reset.analytics.resourcesMinted[resource] - reset.analytics.resourcesSpent[resource]).toBe(stock);
    }
  });

  it("derives counter deltas and newly built structures for an away summary", () => {
    const { state, player } = joined("Lea", "builder");
    const before = clone(state);
    const built = buildStructure(state, player.id, "shelter", "t01", START + 1_000);
    const after = processDueEvents(built.state, START + 61_000);
    const summary = deriveAwaySummary(before, after, START);

    expect(summary).toMatchObject({
      since: START,
      elapsedMs: 61_000,
      pulses: 4,
      ticks: 3,
      structures: 1,
      populationBefore: 24,
    });
    expect(summary.populationAfter).toBe(after.world.population);
  });
});
