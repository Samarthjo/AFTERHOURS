import type { BuildingKey, CityActionKey, Inventory, ResourceKey, RoleKey, Tile } from "./types";

export const GAME_CONFIG = {
  version: "2026.09-balance-1",
  pulseMs: 15_000,
  tickMs: 20_000,
  actionCooldownMs: 12_000,
  tradeExpiryMs: 120_000,
  blackoutDurationMs: 75_000,
  blackoutCooldownMs: 120_000,
  maxOfflineMs: 6 * 60 * 60 * 1000,
  maxEvents: 500,
  maxSamples: 120,
  basePopulationCap: 50,
} as const;

export const RESOURCE_META: Record<ResourceKey, { label: string; short: string; icon: string; color: string }> = {
  materials: { label: "Materials", short: "MAT", icon: "⬡", color: "#ffb86b" },
  water: { label: "Water", short: "WTR", icon: "◆", color: "#64d8ff" },
  tech: { label: "Tech", short: "TEC", icon: "✦", color: "#c7a3ff" },
  energy: { label: "Energy", short: "ENG", icon: "ϟ", color: "#ffe66d" },
  supply: { label: "Supply", short: "SUP", icon: "●", color: "#76ef9d" },
};

export const ROLE_META: Record<RoleKey, { label: string; blurb: string; resource: ResourceKey; starter: Inventory }> = {
  builder: {
    label: "Architect",
    blurb: "Starts ready to expand shelter and infrastructure.",
    resource: "materials",
    starter: { materials: 3, water: 1, tech: 1, energy: 0, supply: 1 },
  },
  grower: {
    label: "Cultivator",
    blurb: "Keeps the city fed and turns water into growth.",
    resource: "water",
    starter: { materials: 1, water: 3, tech: 0, energy: 1, supply: 1 },
  },
  engineer: {
    label: "Systems Engineer",
    blurb: "Repairs critical systems and builds advanced structures.",
    resource: "tech",
    starter: { materials: 2, water: 1, tech: 2, energy: 1, supply: 0 },
  },
  operator: {
    label: "Grid Operator",
    blurb: "Responds to blackouts and restores city power.",
    resource: "energy",
    starter: { materials: 1, water: 1, tech: 1, energy: 2, supply: 1 },
  },
  medic: {
    label: "Civic Medic",
    blurb: "Protects the population when the city begins to fail.",
    resource: "supply",
    starter: { materials: 1, water: 1, tech: 1, energy: 0, supply: 3 },
  },
};

export const BUILDINGS: Record<BuildingKey, {
  label: string;
  icon: string;
  cost: Inventory;
  description: string;
  effect: string;
}> = {
  shelter: {
    label: "Shelter",
    icon: "⌂",
    cost: { materials: 2, water: 1, tech: 0, energy: 0, supply: 0 },
    description: "Safe capacity for the growing population.",
    effect: "+25 population cap",
  },
  farm: {
    label: "Hydro Farm",
    icon: "♧",
    cost: { materials: 1, water: 2, tech: 0, energy: 0, supply: 0 },
    description: "Produces food at every world tick.",
    effect: "+7 food / tick",
  },
  reactor: {
    label: "Reactor",
    icon: "◉",
    cost: { materials: 2, water: 1, tech: 2, energy: 0, supply: 0 },
    description: "Powers buildings and supports population growth.",
    effect: "+8 power / tick",
  },
  medbay: {
    label: "Medbay",
    icon: "✚",
    cost: { materials: 0, water: 1, tech: 1, energy: 0, supply: 1 },
    description: "Reduces losses caused by shortages.",
    effect: "50% lower population loss",
  },
  defense: {
    label: "Grid Shield",
    icon: "◇",
    cost: { materials: 2, water: 0, tech: 1, energy: 1, supply: 0 },
    description: "Softens blackouts and slows structural decay.",
    effect: "−35% crisis damage",
  },
};

export const CITY_ACTIONS: Record<CityActionKey, {
  label: string;
  icon: string;
  cost: Inventory;
  description: string;
}> = {
  feed: {
    label: "Emergency Rations",
    icon: "●",
    cost: { materials: 0, water: 0, tech: 0, energy: 0, supply: 1 },
    description: "+22 food and +2 stability",
  },
  power: {
    label: "Boost the Grid",
    icon: "ϟ",
    cost: { materials: 0, water: 0, tech: 0, energy: 1, supply: 0 },
    description: "+22 power and −6 threat",
  },
  repair: {
    label: "Repair Network",
    icon: "⌁",
    cost: { materials: 1, water: 0, tech: 1, energy: 0, supply: 0 },
    description: "+28 health to the weakest structure",
  },
  stabilize: {
    label: "Civic Relief",
    icon: "✦",
    cost: { materials: 0, water: 1, tech: 0, energy: 0, supply: 1 },
    description: "+15 stability and +5 food",
  },
  restore_grid: {
    label: "Resolve Blackout",
    icon: "↯",
    cost: { materials: 0, water: 0, tech: 1, energy: 1, supply: 0 },
    description: "Restore the district early and stabilize the grid",
  },
};

export const TILES: Tile[] = [
  { id: "t01", q: 0, r: -2, resource: "materials", pulseNumber: 5, district: "North Arc" },
  { id: "t02", q: 1, r: -2, resource: "supply", pulseNumber: 8, district: "North Arc" },
  { id: "t03", q: 2, r: -2, resource: "energy", pulseNumber: 4, district: "North Arc" },
  { id: "t04", q: -1, r: -1, resource: "water", pulseNumber: 6, district: "West Reach" },
  { id: "t05", q: 0, r: -1, resource: "tech", pulseNumber: 9, district: "North Arc" },
  { id: "t06", q: 1, r: -1, resource: "supply", pulseNumber: 10, district: "East Reach" },
  { id: "t07", q: 2, r: -1, resource: "materials", pulseNumber: 9, district: "East Reach" },
  { id: "t08", q: -2, r: 0, resource: "energy", pulseNumber: 8, district: "West Reach" },
  { id: "t09", q: -1, r: 0, resource: "materials", pulseNumber: 5, district: "West Reach" },
  { id: "core", q: 0, r: 0, resource: null, pulseNumber: null, district: "Civic Core" },
  { id: "t11", q: 1, r: 0, resource: "water", pulseNumber: 9, district: "East Reach" },
  { id: "t12", q: 2, r: 0, resource: "tech", pulseNumber: 6, district: "East Reach" },
  { id: "t13", q: -2, r: 1, resource: "tech", pulseNumber: 6, district: "South Arc" },
  { id: "t14", q: -1, r: 1, resource: "supply", pulseNumber: 4, district: "West Reach" },
  { id: "t15", q: 0, r: 1, resource: "energy", pulseNumber: 10, district: "South Arc" },
  { id: "t16", q: 1, r: 1, resource: "water", pulseNumber: 8, district: "East Reach" },
  { id: "t17", q: -2, r: 2, resource: "materials", pulseNumber: 9, district: "South Arc" },
  { id: "t18", q: -1, r: 2, resource: "water", pulseNumber: 8, district: "South Arc" },
  { id: "t19", q: 0, r: 2, resource: "tech", pulseNumber: 5, district: "South Arc" },
];

export const EMPTY_INVENTORY: Inventory = {
  materials: 0,
  water: 0,
  tech: 0,
  energy: 0,
  supply: 0,
};
