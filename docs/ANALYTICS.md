# AFTERHOURS analytics guide

This measurement plan follows the mechanics represented by `types.ts` and `config.ts`. Five roles begin with different mixes of Materials, Water, Tech, Energy, and Supply. Players collect resources on map pulses, build five types of infrastructure, use five emergency city actions, trade with one another or NPC offers, and collectively keep food, power, stability, and building health high enough to survive blackouts and avoid civilization collapse.

The analytics module derives metrics from the server-authoritative `GameState`, which is persisted in `data/world-state.json`; it does not send telemetry to a third party. The capped in-state event/sample buffers and aggregate exports are appropriate for playtests, but they are not a permanent population-level warehouse.

### Scope of the current ledger

The current engine deliberately keeps `AnalyticsState` and its rolling event/sample buffers when a civilization is reset. Therefore joins, sessions, charged-action attempts/successes, all-offer counts, accepted-trade counts, blackout counts, and resource flows are lifetime totals for the persisted server state. Player stock and the world itself describe only the current civilization. The health trend helper selects only samples stamped with the current civilization, because a reset-to-baseline jump is not a survival trend.

This creates two important interpretation rules:

- An export named for the current civilization still contains lifetime counters. Treat `civilization` as the world visible at export time, not the cohort scope of every counter.
- Lifetime source/sink totals reconcile to current player stock. Starter kits and NPC payouts are sources; building/action costs, NPC payments, and inventory retired during a reset are sinks.
- The counter object has no civilization dimension, but every event and sample carries `civilization` and `configVersion`. A server refuses to merge a persisted file from another balance version and preserves it under `data/world-state.rejected-*.json`, preventing cross-version KPI contamination.

Schema 2 also closes two earlier telemetry gaps: NPC offer creation enters the same denominator as player offers, and a civilization reset preserves each identity's lifetime `firstActionAt`. The startup migration backfills schema-1 stock flow, NPC offer counts, event/sample dimensions, and activation markers before play resumes.

## Questions the analyst owns

1. Do new players understand their specialist role and complete a useful action quickly?
2. Are action costs and cooldowns creating decisions rather than repeated rejection?
3. Does role asymmetry create healthy trade, or does one resource become a hard bottleneck?
4. Can a reasonably composed group recover from blackouts before they cause a collapse spiral?
5. Which factor—food, power, stability, or building health—usually leads city decline?
6. Do balance changes improve survival without removing cooperation and crisis tension?

Every comparison must be segmented by `configVersion`. Never combine balance versions in the same treatment result.

## Event dictionary

All events share `id`, `at` (Unix milliseconds), `type`, human-readable `message`, `civilization`, and `configVersion`. `actorId`, `success`, `reason`, and `data` are optional. The message is for the activity feed, not analysis; stable categorical values belong in `data`.

| Event | When it fires | Minimum analytical fields | Recommended `data` fields |
|---|---|---|---|
| `civilization_started` | A new shared world is initialized | `at`, `configVersion` | `civilization`, `rngSeed` only for reproducible internal playtests |
| `player_joined` | A player chooses a name/role and enters | `actorId` | `role`, `homeTileId`, `isReconnect: false` |
| `pulse_resolved` | A resource pulse roll is resolved | — | `roll`, `activeTileCount`, `eligiblePlayerCount` |
| `resource_minted` | A pulse or another source adds inventory | `actorId` when applicable | `resource`, `amount`, `source`, `tileId`, `role` |
| `resource_spent` | A build, action, NPC exchange, or reset removes inventory | `actorId` when applicable | `amount_*`, `source`, `offerId`, `action`, `buildingType` |
| `world_tick` | The city simulation advances | — | `foodDelta`, `powerDelta`, `stabilityDelta`, `healthDelta`, `populationDelta`, `threatDelta` |
| `action_succeeded` | A city/build/trade-capable action completes | `actorId`, `success: true` | `operation`, `countedAsAction`, `cost_*`, plus affected city delta |
| `action_rejected` | An attempted action is refused | `actorId`, `success: false`, stable `reason` | `operation`, `countedAsAction`, `missingResource`, `shortfall`, `cooldownRemainingMs` |
| `building_built` | A structure is placed | `actorId` | `building`, `tileId`, `district`, `role`, `cost_*` |
| `trade_created` | A player or NPC posts an offer | `actorId` for player offers | `giveResource`, `giveAmount`, `wantResource`, `wantAmount`, `npc` |
| `trade_accepted` | An offer is fulfilled | accepting `actorId` | offer dimensions above, `makerRole`, `acceptorRole`, `ageSeconds`, `npc` |
| `trade_expired` | An unfilled offer reaches expiry | — | offer dimensions above, `ageSeconds`, `npc` |
| `blackout_started` | A district blackout begins | — | `district`, `threat`, `disabledTileCount`, city health components |
| `blackout_resolved` | A blackout is restored or times out | `actorId` for manual restore | `district`, `resolution`, `recoverySeconds`, `role` |
| `civilization_collapsed` | The world reaches its failure state | — | `primaryCause`, `ageSeconds`, `players`, health components, `blackouts` |

Use enumerated reasons such as `cooldown`, `insufficient_materials`, `insufficient_energy`, `blackout_inactive`, `invalid_tile`, and `population_cap`; do not analyze human-readable error strings. Resource costs may be flattened as `cost_materials`, `cost_water`, and so on to keep CSV and warehouse schemas stable.

Instrumentation QA for every release:

- One charged build/city attempt produces exactly one event with `countedAsAction: true` and exactly one counter increment.
- One accepted offer was previously created and can never be accepted twice.
- Counter deltas equal corresponding resource-event amounts over the same transition interval; retained events are a capped operational window, not a lifetime ledger.
- Every resolved blackout has one earlier start; automatic timeout and player restoration use distinct `resolution` values.
- Event timestamps are nondecreasing, IDs are unique, and all rows carry the current `configVersion`.

## KPI definitions

Rates in code are decimals from 0 to 1; `percent` fields are presentation values.

| KPI | Definition | Why it matters | Guardrail / caveat |
|---|---|---|---|
| Activation | lifetime first-action observations ÷ lifetime unique joins | Tests whether role selection turns into participation | A reconnect must not increment joins, and reset must not let the same identity record another lifetime first action |
| Time to first action | median and P75 seconds from join to first success | Locates onboarding and affordability friction | Report only for activated joins; pair with activation |
| Action success | successful charged build/city actions ÷ all charged build/city attempts | Measures cost, cooldown, state, and UI friction | Trade/join validation failures also use `action_rejected` events but do not enter this counter; filter events by `data.operation` |
| Trade conversion | all accepted offers ÷ all created player and NPC offers | Tests whether specialist inventories create useful exchange | Split NPC/player counters before interpreting player-to-player market quality separately |
| Mint / spend / net | units created; units removed; minted minus spent, for each resource | Shows faucet/sink balance | Net must equal current player stock; a mismatch raises a critical telemetry warning |
| Stock | sum of the resource currently held by all players | Shows usable liquidity | Current clients do not expose stock history; sample it at each world tick if needed |
| Scarcity index | catalog-cycle demand ÷ (current stock + catalog-cycle demand) | Compares available stock with configured costs on a 0–1 scale | Demand is one of every building plus one of every city action; it is a diagnostic, not a price |
| Crisis recovery | resolved blackouts ÷ started blackouts | Tests whether the cooperative rescue loop works | The current event buffer is capped, so duration percentiles may cover less history than the counters |
| Recovery time | elapsed seconds between matched blackout start and resolution | Distinguishes possible recovery from timely recovery | Compare against the 75-second configured blackout duration; manual and timeout resolutions should be split |
| City health | 25% food + 25% power + 30% stability + 20% building health, each clipped to 0–100 | Gives one readable survival signal without hiding its components | A collapsed city scores zero; tune from components, never the composite alone |
| City health trend | first-to-last health change over the latest 12 current-civilization samples, plus points/minute | Detects a developing death spiral | Fewer than four samples are directional context, not a tuning signal |

Do not infer charged-action KPIs by naively counting event names. `action_rejected` also represents join and trade validation failures, while trade cancellation emits `action_succeeded`; filter both event types to `data.countedAsAction === true`. The authoritative live KPI remains the counter pair.

The primary playtest outcome should be **healthy survival**, not survival alone: a civilization is healthy when it remains alive through the test window, city health stays at or above 40, at least one blackout is recoverable, and trade/action guardrails remain viable. This prevents a change that makes survival trivial by removing cooperation.

## Hypotheses and decision thresholds

Thresholds are starting hypotheses, not universal truths. Freeze them before each playtest, then change them only after reviewing qualitative observation and sample size.

| Hypothesis | Success criterion | Warning threshold in code | First diagnostic |
|---|---|---|---|
| Each role can contribute immediately | Most joins activate and P75 first action is under one minute | activation below 50% after 5 joins; P75 above 60s after 5 activations | role, starter inventory, visible affordable action |
| Costs create legible friction | Attempts usually succeed, but not automatically | success below 65% or above 98% after 20 attempts | rejection reason × action × role |
| Trading resolves role shortages | A meaningful share of offers is accepted | conversion below 25% after 8 offers | offer ratio, resource scarcity, NPC vs player |
| No resource silently blocks the game | Stock can fund a reasonable fraction of the catalog | scarcity at/above 80%, nonpositive net, and at least 5 flow units | pulse access, role mix, sinks, then cost |
| Groups can answer a crisis | Most blackouts resolve | recovery below 60% after 3 starts | Tech/Energy stock, operator presence, action discoverability |
| The city gives time to react | Composite health does not enter an unexplained spiral | health below 40, or a 10-point fall across at least 4 recent samples | align the first drop with tick deltas and crisis events |

Also watch for the opposite failure: oversupply is flagged when scarcity is at most 20% and minting is more than twice spending after meaningful flow. Very high action success is an information signal, not automatic permission to make every cost harsher.

For comparisons, use a fixed playtest duration and target party size. Report the estimate, raw numerator/denominator, and uncertainty. With small internal groups, prefer repeated seeded simulations and effect sizes over claims of statistical significance.

## Tuning and experiment cadence

**Every instrumented playtest**

1. Validate event invariants and record config version, party size, role composition, seed, and test duration.
2. Review the first-action funnel, rejection reasons, per-resource flow/stock, trade lifecycle, health chart, and the event window around each blackout or collapse.
3. Attach two or three player observations to the numbers. A rejected action can be a balance problem, a comprehension problem, or expected game state.

**Twice weekly during active balancing**

- Compare cohorts by config version and party-size band.
- Choose the single most likely constraint in the survival loop.
- Change one balance family only: faucets, costs/sinks, cooldowns, crisis pressure, or building effects.
- Pre-register the expected direction and guardrails, then run the same scenario/seed set on current and candidate configurations.

**Release gate**

- No critical balance warning remains unexplained.
- Event QA passes and exports open correctly in both JSON and CSV.
- Activation, action success, trade conversion, blackout recovery, city health, and collapse/survival are compared with the prior version.
- At least one mixed-role group and one deliberately imperfect composition are tested; a perfect party must not be the only survivable path.

**After enough real sessions exist**

- Use civilization/world as the experiment unit because players share outcomes; never randomize players inside the same world to different balance rules.
- Assign one config version at civilization creation and keep it fixed.
- Choose one primary metric (healthy survival or activation) plus guardrails before launch.
- Run until the predeclared number of civilizations and complete crisis opportunities is reached; do not stop on a favorable early chart.
- Segment by party size, role coverage, reconnect status, and new/returning player, but do not repeatedly slice small samples to search for a win.

## Dashboard layout and analyst deliverables

The minimum dashboard has five sections:

1. **Onboarding:** joins, activation, median/P75 first-action time, activation by role.
2. **Core actions:** attempts, success rate, rejection-reason Pareto, actions per active player.
3. **Economy and trade:** mint/spend/net/stock/scarcity by resource; offers created/accepted/expired; NPC split.
4. **City survival:** the four health components and composite over time; population/capacity; collapse outcome.
5. **Crisis:** starts, recoveries, recovery time, resolution mode, role composition and resource stock at start.

For each balance version, the analyst should deliver a one-page scorecard, an annotated city-health timeline for any collapse, an economy flow table, a ranked rejection-reason table, and a decision note with: evidence, proposed change, expected KPI movement, guardrails, owner, and next test date.

## Privacy and retention

- Collect the minimum required for game balancing. Do not collect real names, email addresses, IP addresses, chat text, precise location, or device fingerprints.
- Use a random, rotating player identifier. Keep the chosen display name out of analytics exports; it remains presentation state only.
- The provided JSON/CSV builders are aggregate-only: they omit player names, actor IDs, event messages, and raw trade/player records. Treat the civilization number and timestamps as pseudonymous operational data.
- Keep raw event access restricted to the development team. Publish only aggregates and suppress small role/party segments where a person could be singled out.
- Define a short raw-event retention window (for example, 30 days for playtesting), then retain version-level aggregates only. The exact period must follow the applicable privacy policy and jurisdiction.
- Provide a clear notice before production telemetry, honor deletion/opt-out requirements, and never repurpose gameplay analytics for advertising or identity profiling.
