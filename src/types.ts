export const RESOURCE_KEYS = ["materials", "water", "tech", "energy", "supply"] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type Inventory = Record<ResourceKey, number>;

export const ROLE_KEYS = ["builder", "grower", "engineer", "operator", "medic"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const BUILDING_KEYS = ["shelter", "farm", "reactor", "medbay", "defense"] as const;
export type BuildingKey = (typeof BUILDING_KEYS)[number];

export type CityActionKey = "feed" | "power" | "repair" | "stabilize" | "restore_grid";
export type TradeStatus = "open" | "accepted" | "cancelled" | "expired";

export interface Tile {
  id: string;
  q: number;
  r: number;
  resource: ResourceKey | null;
  pulseNumber: number | null;
  district: string;
}

export interface Structure {
  id: string;
  type: BuildingKey;
  tileId: string;
  health: number;
  level: number;
  builtAt: number;
  builtBy: string;
}

export interface Player {
  id: string;
  name: string;
  role: RoleKey;
  homeTileId: string;
  inventory: Inventory;
  contribution: number;
  joinedAt: number;
  lastSeenAt: number;
  actionReadyAt: number;
  completedActions: number;
  firstActionAt: number | null;
}

export interface ResourceAmount {
  resource: ResourceKey;
  amount: number;
}

export interface TradeOffer {
  id: string;
  makerId: string;
  makerName: string;
  give: ResourceAmount;
  want: ResourceAmount;
  createdAt: number;
  expiresAt: number;
  status: TradeStatus;
  acceptedBy?: string;
  npc: boolean;
}

export type GameEventType =
  | "civilization_started"
  | "player_joined"
  | "pulse_resolved"
  | "resource_minted"
  | "resource_spent"
  | "world_tick"
  | "action_succeeded"
  | "action_rejected"
  | "building_built"
  | "trade_created"
  | "trade_accepted"
  | "trade_expired"
  | "blackout_started"
  | "blackout_resolved"
  | "civilization_collapsed";

export interface GameEvent {
  id: string;
  at: number;
  type: GameEventType;
  message: string;
  actorId?: string;
  success?: boolean;
  reason?: string;
  data?: Record<string, string | number | boolean | null>;
  civilization: number;
  configVersion: string;
}

export interface BlackoutState {
  active: boolean;
  startedAt: number | null;
  endsAt: number | null;
  cooldownUntil: number;
  district: string | null;
  disabledTileIds: string[];
}

export interface WorldState {
  id: string;
  civilization: number;
  revision: number;
  rngSeed: number;
  createdAt: number;
  updatedAt: number;
  nextPulseAt: number;
  nextTickAt: number;
  pulseCount: number;
  tickCount: number;
  lastPulseRoll: number | null;
  activePulseNumber: number | null;
  activeTileIds: string[];
  population: number;
  populationCap: number;
  food: number;
  power: number;
  stability: number;
  buildingHealth: number;
  threat: number;
  status: "alive" | "collapsed";
  blackout: BlackoutState;
  structures: Structure[];
}

export interface TimeSample {
  at: number;
  civilization: number;
  configVersion: string;
  population: number;
  food: number;
  power: number;
  stability: number;
  buildingHealth: number;
  players: number;
}

export interface AnalyticsState {
  sessions: number;
  joins: number;
  actionAttempts: number;
  actionSuccesses: number;
  tradeOffersCreated: number;
  tradesAccepted: number;
  blackoutsStarted: number;
  blackoutsResolved: number;
  reconnects: number;
  resourcesMinted: Inventory;
  resourcesSpent: Inventory;
  firstActionSeconds: number[];
  samples: TimeSample[];
}

export interface GameState {
  schemaVersion: number;
  configVersion: string;
  world: WorldState;
  players: Player[];
  trades: TradeOffer[];
  events: GameEvent[];
  analytics: AnalyticsState;
}

export interface AwaySummary {
  since: number;
  elapsedMs: number;
  pulses: number;
  ticks: number;
  trades: number;
  blackouts: number;
  structures: number;
  populationBefore: number;
  populationAfter: number;
}

export interface ActionResult {
  state: GameState;
  ok: boolean;
  message: string;
}
