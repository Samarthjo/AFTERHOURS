import { BUILDINGS, CITY_ACTIONS, GAME_CONFIG, RESOURCE_META } from "./config";
import {
  RESOURCE_KEYS,
  type AnalyticsState,
  type GameEvent,
  type GameEventType,
  type GameState,
  type Inventory,
  type ResourceKey,
  type TimeSample,
  type WorldState,
} from "./types";

export type TrendDirection = "up" | "flat" | "down";
export type BalanceWarningSeverity = "info" | "warning" | "critical";
export type SampleMetric = Exclude<keyof TimeSample, "at" | "civilization" | "configVersion">;

export interface RateKpi {
  numerator: number;
  denominator: number;
  rate: number;
  percent: number;
}

export interface ActivationKpis extends RateKpi {
  activatedPlayers: number;
  eligibleJoins: number;
  medianFirstActionSeconds: number | null;
  p75FirstActionSeconds: number | null;
}

export interface EconomyResourceKpi {
  resource: ResourceKey;
  label: string;
  minted: number;
  spent: number;
  net: number;
  stock: number;
  baselineDemand: number;
  scarcityIndex: number;
  scarcityLabel: "abundant" | "balanced" | "tight" | "critical";
}

export interface EconomyKpis {
  minted: Inventory;
  spent: Inventory;
  net: Inventory;
  stock: Inventory;
  totalMinted: number;
  totalSpent: number;
  totalNet: number;
  totalStock: number;
  scarcityIndex: number;
  resources: EconomyResourceKpi[];
}

export interface CrisisRecoveryKpis extends RateKpi {
  started: number;
  resolved: number;
  open: number;
  medianRecoverySeconds: number | null;
  p90RecoverySeconds: number | null;
  targetSeconds: number;
  withinTargetRate: number;
  observedRecoveries: number;
}

export interface CityHealthTrend {
  direction: TrendDirection;
  sampleCount: number;
  first: number | null;
  latest: number | null;
  change: number;
  slopePerMinute: number;
}

export interface AnalyticsKpiSnapshot {
  generatedAt: number;
  configVersion: string;
  activation: ActivationKpis;
  actionSuccess: RateKpi;
  tradeConversion: RateKpi;
  economy: EconomyKpis;
  crisisRecovery: CrisisRecoveryKpis;
  cityHealth: {
    score: number;
    trend: CityHealthTrend;
  };
}

export interface ChartDatum {
  x: number;
  y: number;
  label: string;
}

export interface SvgChartPoint {
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
}

export interface ResourceFlowDatum {
  resource: ResourceKey;
  label: string;
  minted: number;
  spent: number;
  net: number;
  stock: number;
  scarcityIndex: number;
}

export interface BalanceWarning {
  id: string;
  severity: BalanceWarningSeverity;
  message: string;
  evidence: string;
  recommendation: string;
}

export interface AnalyticsExport {
  schemaVersion: 1;
  generatedAt: string;
  configVersion: string;
  gameSchemaVersion: number;
  civilization: number;
  status: WorldState["status"];
  counters: {
    sessions: number;
    joins: number;
    reconnects: number;
    actionAttempts: number;
    actionSuccesses: number;
    tradeOffersCreated: number;
    tradesAccepted: number;
    blackoutsStarted: number;
    blackoutsResolved: number;
  };
  eventCounts: Partial<Record<GameEventType, number>>;
  kpis: AnalyticsKpiSnapshot;
  samples: TimeSample[];
  warnings: BalanceWarning[];
}

export const ANALYTICS_THRESHOLDS = {
  activationWarning: 0.5,
  activationMinimumJoins: 5,
  firstActionP75WarningSeconds: 60,
  actionSuccessLow: 0.65,
  actionSuccessHigh: 0.98,
  actionMinimumAttempts: 20,
  tradeConversionWarning: 0.25,
  tradeMinimumOffers: 8,
  scarcityTight: 0.65,
  scarcityCritical: 0.8,
  economyMinimumFlow: 5,
  crisisRecoveryWarning: 0.6,
  crisisMinimumStarts: 3,
  cityHealthWarning: 40,
  cityHealthCritical: 25,
  cityHealthTrendWarning: -10,
} as const;

const HEALTH_WEIGHTS = {
  food: 0.25,
  power: 0.25,
  stability: 0.3,
  buildingHealth: 0.2,
} as const;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round((finite(value) + Number.EPSILON) * scale) / scale;
}

function analyticsFrom(source: AnalyticsState | GameState): AnalyticsState {
  return "analytics" in source ? source.analytics : source;
}

function rateKpi(numerator: number, denominator: number): RateKpi {
  const safeNumerator = Math.max(0, finite(numerator));
  const safeDenominator = Math.max(0, finite(denominator));
  const rate = safeDenominator > 0 ? clamp(safeNumerator / safeDenominator) : 0;

  return {
    numerator: safeNumerator,
    denominator: safeDenominator,
    rate: round(rate, 4),
    percent: round(rate * 100, 1),
  };
}

function quantile(values: readonly number[], percentile: number): number | null {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (ordered.length === 0) return null;
  if (ordered.length === 1) return round(ordered[0], 1);

  const position = clamp(percentile) * (ordered.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return round(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction, 1);
}

function inventoryTotal(inventory: Inventory): number {
  return RESOURCE_KEYS.reduce((sum, resource) => sum + finite(inventory[resource]), 0);
}

function inventoryMap(project: (resource: ResourceKey) => number): Inventory {
  return Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, round(project(resource), 2)])) as Inventory;
}

/** A join is activated when the player completes a first action. Rates are returned on a 0..1 scale. */
export function activationRate(source: AnalyticsState | GameState): number {
  const analytics = analyticsFrom(source);
  return rateKpi(analytics.firstActionSeconds.length, analytics.joins).rate;
}

export function activationKpis(source: AnalyticsState | GameState): ActivationKpis {
  const analytics = analyticsFrom(source);
  const activatedPlayers = Math.min(analytics.firstActionSeconds.length, Math.max(0, analytics.joins));
  const rate = rateKpi(activatedPlayers, analytics.joins);

  return {
    ...rate,
    activatedPlayers,
    eligibleJoins: Math.max(0, analytics.joins),
    medianFirstActionSeconds: quantile(analytics.firstActionSeconds, 0.5),
    p75FirstActionSeconds: quantile(analytics.firstActionSeconds, 0.75),
  };
}

export function actionSuccessRate(source: AnalyticsState | GameState): number {
  const analytics = analyticsFrom(source);
  return rateKpi(analytics.actionSuccesses, analytics.actionAttempts).rate;
}

export function actionSuccessKpi(source: AnalyticsState | GameState): RateKpi {
  const analytics = analyticsFrom(source);
  return rateKpi(analytics.actionSuccesses, analytics.actionAttempts);
}

export function tradeConversionRate(source: AnalyticsState | GameState): number {
  const analytics = analyticsFrom(source);
  return rateKpi(analytics.tradesAccepted, analytics.tradeOffersCreated).rate;
}

export function tradeConversionKpi(source: AnalyticsState | GameState): RateKpi {
  const analytics = analyticsFrom(source);
  return rateKpi(analytics.tradesAccepted, analytics.tradeOffersCreated);
}

function baselineDemand(resource: ResourceKey): number {
  const buildingDemand = Object.values(BUILDINGS).reduce((sum, building) => sum + building.cost[resource], 0);
  const actionDemand = Object.values(CITY_ACTIONS).reduce((sum, action) => sum + action.cost[resource], 0);
  return buildingDemand + actionDemand;
}

function scarcityLabel(index: number): EconomyResourceKpi["scarcityLabel"] {
  if (index >= ANALYTICS_THRESHOLDS.scarcityCritical) return "critical";
  if (index >= ANALYTICS_THRESHOLDS.scarcityTight) return "tight";
  if (index <= 0.3) return "abundant";
  return "balanced";
}

/**
 * Scarcity compares current player stock with the cost of one complete catalog cycle
 * (one of each building plus one of each city action). It intentionally does not infer
 * monetary value from a resource's label or role.
 */
export function economyKpis(state: GameState): EconomyKpis {
  const minted = inventoryMap((resource) => Math.max(0, state.analytics.resourcesMinted[resource]));
  const spent = inventoryMap((resource) => Math.max(0, state.analytics.resourcesSpent[resource]));
  const stock = inventoryMap((resource) =>
    state.players.reduce((sum, player) => sum + Math.max(0, player.inventory[resource]), 0),
  );
  const net = inventoryMap((resource) => minted[resource] - spent[resource]);

  const resources = RESOURCE_KEYS.map((resource): EconomyResourceKpi => {
    const demand = baselineDemand(resource);
    const index = demand > 0 ? clamp(demand / (stock[resource] + demand)) : 0;

    return {
      resource,
      label: RESOURCE_META[resource].label,
      minted: minted[resource],
      spent: spent[resource],
      net: net[resource],
      stock: stock[resource],
      baselineDemand: demand,
      scarcityIndex: round(index, 3),
      scarcityLabel: scarcityLabel(index),
    };
  });

  const totalDemand = resources.reduce((sum, resource) => sum + resource.baselineDemand, 0);
  const weightedScarcity = totalDemand > 0
    ? resources.reduce((sum, resource) => sum + resource.scarcityIndex * resource.baselineDemand, 0) / totalDemand
    : 0;

  return {
    minted,
    spent,
    net,
    stock,
    totalMinted: round(inventoryTotal(minted), 2),
    totalSpent: round(inventoryTotal(spent), 2),
    totalNet: round(inventoryTotal(net), 2),
    totalStock: round(inventoryTotal(stock), 2),
    scarcityIndex: round(weightedScarcity, 3),
    resources,
  };
}

function blackoutRecoveryDurations(events: readonly GameEvent[]): number[] {
  const starts: number[] = [];
  const durations: number[] = [];

  [...events].sort((a, b) => a.at - b.at).forEach((event) => {
    // A reset abandons any active blackout without emitting a resolution. Never
    // pair that old start with a resolution from the next civilization.
    if (event.type === "civilization_started") {
      starts.length = 0;
      return;
    }

    if (event.type === "blackout_started") {
      starts.push(event.at);
      return;
    }

    if (event.type === "blackout_resolved" && starts.length > 0) {
      const startedAt = starts.shift();
      if (startedAt !== undefined && event.at >= startedAt) {
        durations.push((event.at - startedAt) / 1000);
      }
    }
  });

  return durations;
}

export function crisisRecoveryRate(source: AnalyticsState | GameState): number {
  const analytics = analyticsFrom(source);
  return rateKpi(analytics.blackoutsResolved, analytics.blackoutsStarted).rate;
}

export function crisisRecoveryKpis(state: GameState): CrisisRecoveryKpis {
  const started = Math.max(0, state.analytics.blackoutsStarted);
  const resolved = Math.min(Math.max(0, state.analytics.blackoutsResolved), started);
  const base = rateKpi(resolved, started);
  const durations = blackoutRecoveryDurations(state.events);
  const targetSeconds = GAME_CONFIG.blackoutDurationMs / 1000;
  const withinTarget = durations.filter((duration) => duration < targetSeconds).length;

  return {
    ...base,
    started,
    resolved,
    open: Math.max(0, started - resolved),
    medianRecoverySeconds: quantile(durations, 0.5),
    p90RecoverySeconds: quantile(durations, 0.9),
    targetSeconds,
    withinTargetRate: durations.length > 0 ? round(withinTarget / durations.length, 4) : 0,
    observedRecoveries: durations.length,
  };
}

/** Composite of food, power, stability and structural health; all inputs are normalized to 0..100. */
export function cityHealthScore(
  input: Pick<WorldState, "food" | "power" | "stability" | "buildingHealth"> & Partial<Pick<WorldState, "status">>,
): number {
  if (input.status === "collapsed") return 0;

  const score =
    clamp(input.food, 0, 100) * HEALTH_WEIGHTS.food
    + clamp(input.power, 0, 100) * HEALTH_WEIGHTS.power
    + clamp(input.stability, 0, 100) * HEALTH_WEIGHTS.stability
    + clamp(input.buildingHealth, 0, 100) * HEALTH_WEIGHTS.buildingHealth;

  return round(score, 1);
}

export function cityHealthSeries(samples: readonly TimeSample[]): ChartDatum[] {
  return [...samples]
    .sort((a, b) => a.at - b.at)
    .map((sample) => ({
      x: sample.at,
      y: cityHealthScore(sample),
      label: new Date(sample.at).toISOString(),
    }));
}

export function cityMetricSeries(samples: readonly TimeSample[], metric: SampleMetric): ChartDatum[] {
  return [...samples]
    .sort((a, b) => a.at - b.at)
    .map((sample) => ({
      x: sample.at,
      y: finite(sample[metric]),
      label: new Date(sample.at).toISOString(),
    }));
}

export function cityHealthTrend(samples: readonly TimeSample[], windowSize = 12): CityHealthTrend {
  const series = cityHealthSeries(samples).slice(-Math.max(2, windowSize));
  if (series.length === 0) {
    return { direction: "flat", sampleCount: 0, first: null, latest: null, change: 0, slopePerMinute: 0 };
  }
  if (series.length === 1) {
    return {
      direction: "flat",
      sampleCount: 1,
      first: series[0].y,
      latest: series[0].y,
      change: 0,
      slopePerMinute: 0,
    };
  }

  const first = series[0];
  const latest = series[series.length - 1];
  const change = latest.y - first.y;
  const elapsedMinutes = Math.max((latest.x - first.x) / 60_000, 1 / 60);
  const slopePerMinute = change / elapsedMinutes;
  const direction: TrendDirection = change >= 2 ? "up" : change <= -2 ? "down" : "flat";

  return {
    direction,
    sampleCount: series.length,
    first: round(first.y, 1),
    latest: round(latest.y, 1),
    change: round(change, 1),
    slopePerMinute: round(slopePerMinute, 2),
  };
}

export function resourceFlowSeries(state: GameState): ResourceFlowDatum[] {
  return economyKpis(state).resources.map((resource) => ({
    resource: resource.resource,
    label: resource.label,
    minted: resource.minted,
    spent: resource.spent,
    net: resource.net,
    stock: resource.stock,
    scarcityIndex: resource.scarcityIndex,
  }));
}

/** Converts arbitrary x/y data into padded SVG coordinates. */
export function lineChartPoints(
  data: readonly Pick<ChartDatum, "x" | "y">[],
  width: number,
  height: number,
  padding = 8,
): SvgChartPoint[] {
  if (data.length === 0 || width <= 0 || height <= 0) return [];

  const xs = data.map((point) => finite(point.x));
  const ys = data.map((point) => finite(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;
  const drawableWidth = Math.max(0, width - padding * 2);
  const drawableHeight = Math.max(0, height - padding * 2);

  return data.map((point) => ({
    x: round(padding + ((finite(point.x) - minX) / xRange) * drawableWidth, 2),
    y: round(height - padding - ((finite(point.y) - minY) / yRange) * drawableHeight, 2),
    sourceX: finite(point.x),
    sourceY: finite(point.y),
  }));
}

export function sparklinePoints(
  data: readonly Pick<ChartDatum, "x" | "y">[],
  width: number,
  height: number,
  padding = 4,
): string {
  return lineChartPoints(data, width, height, padding)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

function currentCivilizationSamples(state: GameState): TimeSample[] {
  return state.analytics.samples.filter((sample) => sample.civilization === state.world.civilization);
}

export function buildKpiSnapshot(state: GameState, generatedAt = Date.now()): AnalyticsKpiSnapshot {
  return {
    generatedAt,
    configVersion: state.configVersion,
    activation: activationKpis(state),
    actionSuccess: actionSuccessKpi(state),
    tradeConversion: tradeConversionKpi(state),
    economy: economyKpis(state),
    crisisRecovery: crisisRecoveryKpis(state),
    cityHealth: {
      score: cityHealthScore(state.world),
      // Counters are lifetime totals, but a reset returns city vitals to their
      // baseline. A survival trend that crosses that boundary is not meaningful.
      trend: cityHealthTrend(currentCivilizationSamples(state)),
    },
  };
}

export const deriveAnalyticsKpis = buildKpiSnapshot;

function warning(
  id: string,
  severity: BalanceWarningSeverity,
  message: string,
  evidence: string,
  recommendation: string,
): BalanceWarning {
  return { id, severity, message, evidence, recommendation };
}

/** Warnings are gated by minimum sample sizes so a new civilization is not treated as a balance failure. */
export function getBalanceWarnings(state: GameState): BalanceWarning[] {
  const result: BalanceWarning[] = [];
  const activation = activationKpis(state);
  const action = actionSuccessKpi(state);
  const trade = tradeConversionKpi(state);
  const economy = economyKpis(state);
  const crisis = crisisRecoveryKpis(state);
  const healthScore = cityHealthScore(state.world);
  const healthTrend = cityHealthTrend(currentCivilizationSamples(state));

  if (state.analytics.firstActionSeconds.length > state.analytics.joins) {
    result.push(warning(
      "telemetry-activation-duplicate",
      "critical",
      "Activation telemetry contains more first actions than unique joins.",
      `${state.analytics.firstActionSeconds.length} first-action observations for ${state.analytics.joins} joins.`,
      "Preserve a player's lifetime firstActionAt during civilization reset, or version activation by civilization.",
    ));
  }

  if (state.analytics.tradesAccepted > state.analytics.tradeOffersCreated) {
    result.push(warning(
      "telemetry-trade-denominator",
      "critical",
      "Trade conversion has accepted offers missing from its creation denominator.",
      `${state.analytics.tradesAccepted} accepted versus ${state.analytics.tradeOffersCreated} recorded creations.`,
      "Count NPC offer creation or split player and NPC trade counters before interpreting conversion.",
    ));
  }

  if (state.analytics.actionSuccesses > state.analytics.actionAttempts) {
    result.push(warning(
      "telemetry-action-invariant",
      "critical",
      "Successful charged actions exceed recorded attempts.",
      `${state.analytics.actionSuccesses} successes versus ${state.analytics.actionAttempts} attempts.`,
      "Audit build and city-action mutations; every success and rejection must increment attempts exactly once.",
    ));
  }

  if (state.analytics.blackoutsResolved > state.analytics.blackoutsStarted) {
    result.push(warning(
      "telemetry-blackout-invariant",
      "critical",
      "Resolved blackouts exceed recorded starts.",
      `${state.analytics.blackoutsResolved} resolutions versus ${state.analytics.blackoutsStarted} starts.`,
      "Audit manual and automatic resolution paths for duplicate resolution.",
    ));
  }

  const unreconciledResources = economy.resources.filter(
    (resource) => Math.abs(resource.net - resource.stock) > 0.001,
  );
  if (unreconciledResources.length > 0) {
    result.push(warning(
      "telemetry-economy-reconciliation",
      "critical",
      "Economy sources and sinks do not reconcile with current player stock.",
      unreconciledResources
        .map((resource) => `${resource.label}: net ${resource.net}, stock ${resource.stock}`)
        .join("; "),
      "Audit starter grants, resets, building/action costs, pulses, and NPC trades before making balance decisions.",
    ));
  }

  if (
    activation.eligibleJoins >= ANALYTICS_THRESHOLDS.activationMinimumJoins
    && activation.rate < ANALYTICS_THRESHOLDS.activationWarning
  ) {
    result.push(warning(
      "activation-low",
      "warning",
      "Too few new players reach a first successful action.",
      `${activation.percent}% activated across ${activation.eligibleJoins} joins.`,
      "Review role onboarding, starter inventories, and the first cooldown or cost shown to each role.",
    ));
  }

  if (
    activation.p75FirstActionSeconds !== null
    && activation.activatedPlayers >= ANALYTICS_THRESHOLDS.activationMinimumJoins
    && activation.p75FirstActionSeconds > ANALYTICS_THRESHOLDS.firstActionP75WarningSeconds
  ) {
    result.push(warning(
      "first-action-slow",
      "warning",
      "The first useful action takes too long for a quarter of activated players.",
      `P75 time to first action is ${activation.p75FirstActionSeconds}s.`,
      "Make the role's best starter action obvious and ensure it is affordable immediately.",
    ));
  }

  if (action.denominator >= ANALYTICS_THRESHOLDS.actionMinimumAttempts) {
    if (action.rate < ANALYTICS_THRESHOLDS.actionSuccessLow) {
      result.push(warning(
        "actions-too-hard",
        "critical",
        "Action rejection is high enough to interrupt the core play loop.",
        `${action.percent}% of ${action.denominator} attempts succeeded.`,
        "Break rejections down by reason, role, and action before lowering costs or cooldowns.",
      ));
    } else if (action.rate > ANALYTICS_THRESHOLDS.actionSuccessHigh) {
      result.push(warning(
        "actions-low-friction",
        "info",
        "Almost every attempted action succeeds, so resource choices may lack tension.",
        `${action.percent}% of ${action.denominator} attempts succeeded.`,
        "Check whether shortages and role dependencies ever create meaningful trade-offs before increasing difficulty.",
      ));
    }
  }

  if (
    trade.denominator >= ANALYTICS_THRESHOLDS.tradeMinimumOffers
    && trade.rate < ANALYTICS_THRESHOLDS.tradeConversionWarning
  ) {
    result.push(warning(
      "trade-conversion-low",
      "warning",
      "Most trade offers do not create an exchange.",
      `${trade.percent}% of ${trade.denominator} offers were accepted.`,
      "Compare requested ratios with resource scarcity and show counterpart demand before changing NPC liquidity.",
    ));
  }

  economy.resources.forEach((resource) => {
    const flow = resource.minted + resource.spent;
    if (
      flow >= ANALYTICS_THRESHOLDS.economyMinimumFlow
      && resource.scarcityIndex >= ANALYTICS_THRESHOLDS.scarcityCritical
      && resource.net <= 0
    ) {
      result.push(warning(
        `scarcity-${resource.resource}`,
        "critical",
        `${resource.label} is critically scarce relative to configured build and action costs.`,
        `${resource.stock} in player stock; net flow ${resource.net}; scarcity ${round(resource.scarcityIndex * 100, 0)}%.`,
        `Inspect ${resource.label} pulse yield, role mix, sinks, and failed actions before changing its costs.`,
      ));
    } else if (
      flow >= ANALYTICS_THRESHOLDS.economyMinimumFlow
      && resource.scarcityIndex <= 0.2
      && resource.minted > resource.spent * 2
    ) {
      result.push(warning(
        `oversupply-${resource.resource}`,
        "info",
        `${resource.label} is accumulating much faster than it is used.`,
        `${resource.minted} minted, ${resource.spent} spent, ${resource.stock} held.`,
        `Validate whether ${resource.label} needs another strategic sink or a lower pulse yield.`,
      ));
    }
  });

  if (
    crisis.started >= ANALYTICS_THRESHOLDS.crisisMinimumStarts
    && crisis.rate < ANALYTICS_THRESHOLDS.crisisRecoveryWarning
  ) {
    result.push(warning(
      "crisis-recovery-low",
      "critical",
      "Too many blackouts remain unresolved.",
      `${crisis.percent}% of ${crisis.started} blackouts were resolved; ${crisis.open} remain open in cumulative telemetry.`,
      "Check access to Tech and Energy, operator participation, and visibility of Resolve Blackout.",
    ));
  }

  if (healthScore < ANALYTICS_THRESHOLDS.cityHealthWarning) {
    const severity: BalanceWarningSeverity = healthScore < ANALYTICS_THRESHOLDS.cityHealthCritical ? "critical" : "warning";
    result.push(warning(
      "city-health-low",
      severity,
      "The civilization is operating with low combined reserves and resilience.",
      `City health is ${healthScore}/100.`,
      "Inspect food, power, stability, and building health separately; tune only the factor that consistently leads the decline.",
    ));
  }

  if (
    healthTrend.sampleCount >= 4
    && healthTrend.change <= ANALYTICS_THRESHOLDS.cityHealthTrendWarning
  ) {
    result.push(warning(
      "city-health-falling",
      "warning",
      "City health is falling across recent world samples.",
      `${healthTrend.change} points across ${healthTrend.sampleCount} samples (${healthTrend.slopePerMinute}/min).`,
      "Mark the first falling sample and compare nearby ticks, pulse income, builds, and crises before tuning production.",
    ));
  }

  return result;
}

export function getBalanceWarningMessages(state: GameState): string[] {
  return getBalanceWarnings(state).map(
    (item) => `${item.message} ${item.evidence} ${item.recommendation}`,
  );
}

function eventCounts(events: readonly GameEvent[]): Partial<Record<GameEventType, number>> {
  return events.reduce<Partial<Record<GameEventType, number>>>((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
}

/** Aggregate-only export: player names, player ids, free-text messages and raw actor ids are omitted. */
export function buildAnalyticsExport(state: GameState, generatedAt = Date.now()): AnalyticsExport {
  return {
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    configVersion: state.configVersion,
    gameSchemaVersion: state.schemaVersion,
    civilization: state.world.civilization,
    status: state.world.status,
    counters: {
      sessions: state.analytics.sessions,
      joins: state.analytics.joins,
      reconnects: state.analytics.reconnects,
      actionAttempts: state.analytics.actionAttempts,
      actionSuccesses: state.analytics.actionSuccesses,
      tradeOffersCreated: state.analytics.tradeOffersCreated,
      tradesAccepted: state.analytics.tradesAccepted,
      blackoutsStarted: state.analytics.blackoutsStarted,
      blackoutsResolved: state.analytics.blackoutsResolved,
    },
    eventCounts: eventCounts(state.events),
    kpis: buildKpiSnapshot(state, generatedAt),
    samples: state.analytics.samples.map((sample) => ({ ...sample })),
    warnings: getBalanceWarnings(state),
  };
}

export function buildAnalyticsJson(
  state: GameState,
  options: { pretty?: boolean; generatedAt?: number } = {},
): string {
  const indentation = options.pretty === false ? 0 : 2;
  return JSON.stringify(buildAnalyticsExport(state, options.generatedAt), null, indentation);
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Long-form CSV is intentionally chart- and spreadsheet-friendly: one metric per row. */
export function buildAnalyticsCsv(state: GameState, generatedAt = Date.now()): string {
  const snapshot = buildKpiSnapshot(state, generatedAt);
  const rows: Array<[string, string, string, string | number | null, string]> = [
    ["meta", "generated_at", "all", new Date(generatedAt).toISOString(), "iso8601"],
    ["meta", "config_version", "all", state.configVersion, "version"],
    ["engagement", "activation_rate", "all", snapshot.activation.rate, "ratio"],
    ["engagement", "median_first_action", "all", snapshot.activation.medianFirstActionSeconds, "seconds"],
    ["engagement", "p75_first_action", "all", snapshot.activation.p75FirstActionSeconds, "seconds"],
    ["actions", "success_rate", "all", snapshot.actionSuccess.rate, "ratio"],
    ["trades", "conversion_rate", "all", snapshot.tradeConversion.rate, "ratio"],
    ["crisis", "recovery_rate", "blackout", snapshot.crisisRecovery.rate, "ratio"],
    ["crisis", "median_recovery", "blackout", snapshot.crisisRecovery.medianRecoverySeconds, "seconds"],
    ["crisis", "within_target_rate", "blackout", snapshot.crisisRecovery.withinTargetRate, "ratio"],
    ["city", "health_score", "all", snapshot.cityHealth.score, "score_0_100"],
    ["city", "health_change", "recent_window", snapshot.cityHealth.trend.change, "points"],
    ["city", "health_slope", "recent_window", snapshot.cityHealth.trend.slopePerMinute, "points_per_minute"],
  ];

  snapshot.economy.resources.forEach((resource) => {
    rows.push(
      ["economy", "minted", resource.resource, resource.minted, "units"],
      ["economy", "spent", resource.resource, resource.spent, "units"],
      ["economy", "net", resource.resource, resource.net, "units"],
      ["economy", "stock", resource.resource, resource.stock, "units"],
      ["economy", "scarcity_index", resource.resource, resource.scarcityIndex, "ratio"],
    );
  });

  const lines = [
    ["category", "metric", "dimension", "value", "unit"],
    ...rows,
  ];
  return `${lines.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
