import { describe, expect, it } from "vitest";

import {
  actionSuccessKpi,
  activationKpis,
  buildAnalyticsCsv,
  buildAnalyticsJson,
  buildKpiSnapshot,
  cityHealthScore,
  crisisRecoveryRate,
  economyKpis,
  getBalanceWarnings,
  tradeConversionKpi,
} from "./analytics";
import { GAME_CONFIG } from "./config";
import { createInitialState, joinPlayer } from "./engine";
import type { AnalyticsState, Inventory, TimeSample } from "./types";

const START = 1_000_000;

function emptyInventory(): Inventory {
  return { materials: 0, water: 0, tech: 0, energy: 0, supply: 0 };
}

function emptyAnalytics(): AnalyticsState {
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
    resourcesMinted: emptyInventory(),
    resourcesSpent: emptyInventory(),
    firstActionSeconds: [],
    samples: [],
  };
}

function sample(at: number, civilization: number, health: number): TimeSample {
  return {
    at,
    civilization,
    configVersion: GAME_CONFIG.version,
    population: 24,
    food: health,
    power: health,
    stability: health,
    buildingHealth: health,
    players: 1,
  };
}

describe("analytics KPI math", () => {
  it("returns stable zeroes when rate denominators are empty", () => {
    const analytics = emptyAnalytics();

    expect(activationKpis(analytics)).toMatchObject({
      numerator: 0,
      denominator: 0,
      rate: 0,
      percent: 0,
      medianFirstActionSeconds: null,
      p75FirstActionSeconds: null,
    });
    expect(actionSuccessKpi(analytics)).toEqual({ numerator: 0, denominator: 0, rate: 0, percent: 0 });
    expect(tradeConversionKpi(analytics)).toEqual({ numerator: 0, denominator: 0, rate: 0, percent: 0 });
    expect(crisisRecoveryRate(analytics)).toBe(0);
  });

  it("derives rates, activation latency percentiles, and weighted city health", () => {
    const analytics = emptyAnalytics();
    analytics.joins = 4;
    analytics.firstActionSeconds = [10, 20, 30];
    analytics.actionAttempts = 8;
    analytics.actionSuccesses = 6;
    analytics.tradeOffersCreated = 5;
    analytics.tradesAccepted = 2;
    analytics.blackoutsStarted = 4;
    analytics.blackoutsResolved = 3;

    expect(activationKpis(analytics)).toMatchObject({
      activatedPlayers: 3,
      eligibleJoins: 4,
      rate: 0.75,
      percent: 75,
      medianFirstActionSeconds: 20,
      p75FirstActionSeconds: 25,
    });
    expect(actionSuccessKpi(analytics)).toEqual({ numerator: 6, denominator: 8, rate: 0.75, percent: 75 });
    expect(tradeConversionKpi(analytics)).toEqual({ numerator: 2, denominator: 5, rate: 0.4, percent: 40 });
    expect(crisisRecoveryRate(analytics)).toBe(0.75);
    expect(cityHealthScore({ food: 80, power: 60, stability: 40, buildingHealth: 20 })).toBe(51);
  });
});

describe("analytics scope and integrity", () => {
  it("builds the health trend from only the current civilization's samples", () => {
    const state = createInitialState(START);
    state.world.civilization = 2;
    state.world.createdAt = START + 120_000;
    state.analytics.samples = [
      sample(START, 1, 5),
      sample(START + 60_000, 1, 100),
      sample(START + 120_000, 2, 80),
      sample(START + 180_000, 2, 60),
    ];

    expect(buildKpiSnapshot(state, START + 180_000).cityHealth.trend).toEqual({
      direction: "down",
      sampleCount: 2,
      first: 80,
      latest: 60,
      change: -20,
      slopePerMinute: -20,
    });
  });

  it("warns only when lifetime economy net flow stops matching current stock", () => {
    const joined = joinPlayer(createInitialState(START), "Ledger Keeper", "builder", START);
    expect(joined.ok).toBe(true);

    const economy = economyKpis(joined.state);
    for (const resource of economy.resources) {
      expect(resource.net).toBe(resource.stock);
    }
    expect(getBalanceWarnings(joined.state).map((item) => item.id)).not.toContain(
      "telemetry-economy-reconciliation",
    );

    const corrupted = structuredClone(joined.state);
    corrupted.players[0].inventory.materials += 1;
    const reconciliation = getBalanceWarnings(corrupted).find(
      (item) => item.id === "telemetry-economy-reconciliation",
    );

    expect(reconciliation).toMatchObject({ severity: "critical" });
    expect(reconciliation?.evidence).toContain("Materials");
    expect(reconciliation?.evidence).toContain("net 3, stock 4");
  });
});

describe("analytics exports", () => {
  it("exports aggregate JSON and CSV without player names or identifiers", () => {
    const privateName = "Private Playtester";
    const joined = joinPlayer(createInitialState(START), privateName, "engineer", START);
    expect(joined.ok).toBe(true);
    const privateId = joined.state.players[0].id;

    const json = buildAnalyticsJson(joined.state, { generatedAt: START, pretty: false });
    const csv = buildAnalyticsCsv(joined.state, START);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty("players");
    expect(parsed).not.toHaveProperty("events");
    expect(json).not.toContain(privateName);
    expect(json).not.toContain(privateId);
    expect(json).not.toContain("actorId");
    expect(csv).not.toContain(privateName);
    expect(csv).not.toContain(privateId);
    expect(csv).toContain("category,metric,dimension,value,unit");
  });
});
