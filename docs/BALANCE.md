# AFTERHOURS balance specification and playtest workbook

This document explains the current tuning, the 2d6 economy behind it, and how to decide whether to change a number. The executable source of truth is `src/config.ts` plus the simulation formulas in `src/engine.ts`. All results must be tagged with config version `2026.09-balance-1`; do not pool runs from different versions.

## Design intent

AFTERHOURS should feel like a shared emergency, not five independent optimization games. A healthy session has four properties:

1. A new player can make a useful choice quickly.
2. Specialists have enough personal agency to contribute but need trade and coordination for the best responses.
3. The city telegraphs decline early enough for a group to recover.
4. Infrastructure buys resilience without making blackouts or resource decisions irrelevant.

The primary outcome is **healthy survival**: the civilization stays alive through the test window, recovers from at least one crisis, and keeps composite city health above 40 without eliminating trade or meaningful shortages. Raw survival time alone can reward passive or degenerate strategies.

## Current baseline

### Initial world

| Parameter | Value |
| --- | ---: |
| Population | 24 |
| Population cap | 50 |
| Food | 75 / 100 |
| Power | 70 / 100 |
| Stability | 80 / 100 |
| Building health | 100 / 100 |
| Threat | 10 / 100 |
| Structures | 0 |
| NPC offers kept open | 2 |

Food, power, stability, building health, and threat are clamped to 0-100. The civilization collapses when population or stability reaches 0, threat reaches 100, or every built structure has reached 0 health. Having no structures is not itself a collapse condition.

### Cadence and retention

| Parameter | Current value | Practical meaning |
| --- | ---: | --- |
| Resource pulse | 15 seconds | 4 rolls/minute; 240/hour |
| World tick | 20 seconds | 3 survival updates/minute; 180/hour |
| Action cooldown | 12 seconds | At most 5 successful charged actions/minute/player before resource limits |
| Trade expiry | 120 seconds | Two minutes to find a counterparty |
| Blackout duration | 75 seconds | Usually 3-4 world ticks depending on timer alignment |
| Blackout cooldown | 120 seconds | Earliest eligible roll is after scheduled end + 120 seconds |
| Offline catch-up cap | 6 hours | Bounds server restart work and unattended decline |
| Event buffer | 500 | Rolling operational context, not lifetime history |
| Sample buffer | 120 | About 40 minutes at one sample per 20-second tick |

The 15-second and 20-second timers coincide once per minute. The engine resolves a pulse before a tick when their timestamps are equal. Treat that order as a balance rule: a matching payout or roll-7 blackout can change the immediately following tick.

## 2d6 pulse math

Two independent six-sided dice produce 36 equally likely ordered outcomes. Middle sums are common; edge sums are rare.

| Sum | Ways | Probability | Configured tiles | Pulse outcome |
| ---: | ---: | ---: | ---: | --- |
| 2 | 1 | 2.78% | 0 | No production |
| 3 | 2 | 5.56% | 0 | No production |
| 4 | 3 | 8.33% | 2 | Energy, Supply |
| 5 | 4 | 11.11% | 3 | Materials x2, Tech |
| 6 | 5 | 13.89% | 3 | Water, Tech x2 |
| 7 | 6 | 16.67% | 0 | Starts a blackout when eligible; otherwise no production |
| 8 | 5 | 13.89% | 4 | Supply, Energy, Water x2 |
| 9 | 4 | 11.11% | 4 | Tech, Materials x2, Water |
| 10 | 3 | 8.33% | 2 | Supply, Energy |
| 11 | 2 | 5.56% | 0 | No production |
| 12 | 1 | 2.78% | 0 | No production |

Consequences:

- A productive number appears on 24/36 rolls, or **66.67%** of pulses before blackout disabling.
- Roll 7 is a crisis check on 6/36 rolls, or **16.67%** of pulses.
- Edge blanks (2, 3, 11, 12) account for the remaining **16.67%**.
- One pulse activates 75/36 = **2.083 configured tiles on average**, before blackouts. This counts active tiles, not resources actually minted.
- A player receives one unit only when their own home tile is active. Empty active tiles create nothing; several players on the same active tile each receive one unit.
- A district blackout removes its tiles from both activation and building operation until resolved.

### Home-tile rate

| Home number | Hit chance/pulse | Expected wait | Expected units/minute | Expected units/hour |
| --- | ---: | ---: | ---: | ---: |
| 4 or 10 | 8.33% | 3.00 min | 0.333 | 20.0 |
| 5 or 9 | 11.11% | 2.25 min | 0.444 | 26.7 |
| 6 or 8 | 13.89% | 1.80 min | 0.556 | 33.3 |

These are long-run pre-blackout expectations. Short sessions will be noisy. A 6/8 home tile has a 66.7% higher expected faucet than a 4/10 tile, so compare roles and home numbers before concluding that a cost is wrong.

Players do not manually choose a home tile. The server assigns the least-occupied tile producing the role's specialty; ties follow map order. That spreads a crowded role across its resource tiles, but early join order can assign different production rates.

### Board-weighted resource supply

The table below sums the 2d6 weights of all tiles for each resource. It describes full-board activation opportunity, not actual minting; occupancy determines the latter.

| Resource | Tiles | Sum of dice weights | Expected active tiles/pulse | Per minute | Per hour |
| --- | ---: | ---: | ---: | ---: | ---: |
| Materials | 4 | 16/36 | 0.444 | 1.78 | 106.7 |
| Water | 4 | 19/36 | 0.528 | 2.11 | 126.7 |
| Tech | 4 | 18/36 | 0.500 | 2.00 | 120.0 |
| Energy | 3 | 11/36 | 0.306 | 1.22 | 73.3 |
| Supply | 3 | 11/36 | 0.306 | 1.22 | 73.3 |

Energy and Supply have only 58-61% of Water/Tech's board-weighted opportunity. That is intentional pressure because the strongest immediate recovery actions use Energy or Supply, but it is also the first place to look when a group cannot answer crises.

## Role economy

All roles receive six total starter units.

| Role | Specialty | MAT | WTR | TEC | ENG | SUP | First assigned home |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Architect | Materials | 3 | 1 | 1 | 0 | 1 | Materials 5 (0.444/min) |
| Cultivator | Water | 1 | 3 | 0 | 1 | 1 | Water 6 (0.556/min) |
| Systems Engineer | Tech | 2 | 1 | 2 | 1 | 0 | Tech 9 (0.444/min) |
| Grid Operator | Energy | 1 | 1 | 1 | 2 | 1 | Energy 4 (0.333/min) |
| Civic Medic | Supply | 1 | 1 | 1 | 0 | 3 | Supply 8 (0.556/min) |

The Grid Operator begins on the slowest first-assigned faucet even though Energy is a crisis bottleneck. This may encourage trade; it may also make the role feel ineffective. Measure time to first useful action and Energy stock by home number before changing the starter kit.

Joining with the same display name (case-insensitive) reconnects to the existing player and does not grant another starter inventory. A civilization reset preserves the roster and roles, restores each player's starter inventory, resets their action/contribution fields, removes structures/trades, and increments the civilization number. Aggregate analytics and the rolling event/sample buffers continue across civilizations, so segment results by civilization as well as config version.

## Costs and effects

### Structures

| Structure | MAT | WTR | TEC | ENG | SUP | Total cost | Effect |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Shelter | 2 | 1 | 0 | 0 | 0 | 3 | +25 population cap while health > 0 |
| Hydro Farm | 1 | 2 | 0 | 0 | 0 | 3 | +7 food/tick while active |
| Reactor | 2 | 1 | 2 | 0 | 0 | 5 | +8 power/tick while active |
| Medbay | 0 | 1 | 1 | 0 | 1 | 3 | Halves shortage population loss while active |
| Grid Shield | 2 | 0 | 1 | 1 | 0 | 4 | One or more active shields soften crisis effects; multiple do not stack |

A building can be placed on any producing tile, one structure per tile. Building consumes the player's action charge. An active structure has health above zero and is not in the currently blacked-out district. Shelters continue to count toward capacity while alive even when their district is blacked out.

The displayed Grid Shield claim is 35% less crisis damage. Because current damage is rounded, actual reductions vary: initial blackout power loss goes 12 -> 8, stability loss 5 -> 3, and threat gain 10 -> 7. Ordinary two-point structural decay becomes `ceil(2 x 0.65) = 2`, so the shield does not reduce that smallest decay packet; a six-point combined decay becomes four.

### Immediate city actions

| Action | Cost | Direct effect |
| --- | --- | --- |
| Emergency Rations | 1 Supply | +22 food, +2 stability |
| Boost the Grid | 1 Energy | +22 power, -6 threat |
| Repair Network | 1 Materials + 1 Tech | +28 health to the weakest damaged structure |
| Civic Relief | 1 Water + 1 Supply | +15 stability, +5 food |
| Resolve Blackout | 1 Tech + 1 Energy | Ends the blackout; +12 power, +6 stability, -10 threat |

All values clamp to 0-100. Every successful city/build action adds one base contribution point plus the total resource cost. This deliberately gives a five-unit Reactor more contribution weight than a one-unit ration or grid boost; confirm that weighting is desirable before treating contribution as a leaderboard metric.

Trades do not use the 12-second action charge. A player may keep only one open player offer. Amounts reaching the server are limited to whole units 1-9 and offers expire after two minutes. Player goods are not escrowed: acceptance atomically rechecks both balances. NPC offers sink the requested resource and mint the offered resource; the server maintains two open NPC offers from a fixed five-template cycle.

## World-tick formulas

All thresholds use the values **after** food and power production/consumption for that tick.

```text
food demand  = max(2, ceil(population / 12))
power demand = max(2, ceil(population / 16) + ceil(total structures / 3))

food'  = clamp(food  + 7 * active farms    - food demand)
power' = clamp(power + 8 * active reactors - power demand - (blackout ? 8 : 0))
```

Power demand counts all structures, including disabled or zero-health structures; production counts only active farms/reactors. That asymmetry makes damaged infrastructure a potential debt spiral and should be monitored.

### Stability and threat

Definitions:

- `foodCritical`: food < 20
- `powerCritical`: power < 20
- `healthy`: food >= 35 and power >= 35

```text
stability delta starts at +1 if healthy, otherwise 0
  -5 if foodCritical
  -5 if powerCritical
  -3 during a blackout
  -4 while threat >= 75 (using threat at tick start)

threat delta starts at -1 if healthy, otherwise +4
  +4 if foodCritical
  +4 if powerCritical
  +6 during a blackout
  -2 if any Grid Shield is active
```

This creates a deliberate cliff between 35 and 20: a city with a meter from 20-34 does not yet take the -5 critical penalty, but it loses healthy recovery and gains +4 threat per tick.

### Population

- Danger exists if food < 10, power < 10, or stability < 15.
- In danger, population loses `max(1, ceil(population x 5%))` each tick.
- With at least one active Medbay, loss becomes `max(1, ceil(loss / 2))`; several Medbays do not stack.
- Otherwise, population grows by one when food, power, and stability are all strictly above 40 and population is below cap.
- Capacity is `50 + 25 x living shelters`. Population is clamped down immediately if capacity falls below it.

At the initial population of 24 with no structures, food demand is 2 and power demand is 2. Because all three growth conditions initially pass, population grows by one each tick, increasing demand as it expands. The starting reserves are a grace period, not a sustainable engine.

### Structural damage

- Every structure takes 2 damage/tick when food < 20, power < 20, or threat >= 70.
- A structure in the disabled blackout district takes another 4 damage/tick.
- If any Grid Shield is active, the combined packet is multiplied by 0.65 and rounded up.
- `buildingHealth` is the rounded average across all structures, including destroyed structures. With none built it displays 100.

Repair targets the lowest-health damaged structure; ties go to the earlier `builtAt`. A deterministic tie-break after identical timestamps should be tested because simultaneous construction timestamps can otherwise leave ordering dependent on array order.

## Blackout model

A 7 rolled on a 15-second pulse starts a blackout if none is active and the cooldown timestamp has passed. The district is chosen uniformly from North, East, South, and West; North/West each contain four tiles, East/South five, so an average blackout disables 4.5 tiles.

At start:

| Effect | No active shield | Active shield |
| --- | ---: | ---: |
| Power | -12 | -8 |
| Stability | -5 | -3 |
| Threat | +10 | +7 |

During each blackout tick, the city also loses 8 power, 3 stability, and gains 6 threat before any shield threat reduction. Buildings and production on disabled tiles are inactive.

Automatic resolution after 75 seconds restores +4 power, +3 stability, and -4 threat. Manual resolution uses one player's charged action and 1 Tech + 1 Energy, restoring +12 power, +6 stability, and -10 threat.

Cooldown is set when the blackout begins to `start + 75s + 120s`. Manual early resolution does not shorten it. Because this timestamp lands exactly on a scheduled pulse, that pulse is the first eligible crisis check. A geometric 7 has a mean of six eligible trials, putting the next start about 75 seconds after eligibility on average. The rough uninterrupted start-to-start cycle is therefore 75 + 120 + 75 = **270 seconds (4.5 minutes)**, though dice variance is large.

## Economy assumptions to test

These are hypotheses behind the baseline, not established facts:

1. **Six starter units buy immediate agency.** Each role should see at least one understandable useful action without waiting for a pulse.
2. **Energy and Supply are intentionally scarce.** Their lower board weight should increase coordination, not make recovery impossible for groups missing the Operator or Medic.
3. **One early farm and reactor stabilize the opening.** Their per-tick output is larger than early demand, but placement, mixed cost, action cooldown, and blackouts delay the engine.
4. **Structures create a positive curve with a brake.** Farms/reactors add output; every three total structures add one point of power demand, and crises can disable/damage them.
5. **The 12-second charge stops command spam, not trading.** Actual charged-action throughput should be resource-limited well below five per minute for most players.
6. **Two-minute offers are long enough in a live group.** If offers mostly expire because players never notice them, improve discovery before extending the timer.
7. **A 75-second blackout allows response.** It suppresses four subsequent pulse resolutions before automatic resolution at the fifth 15-second boundary, and applies during three or four world ticks depending on timer phase. That should leave enough time to trade for a manual restore without making inaction harmless.
8. **Six-hour catch-up is an operational bound, not a promise of safety.** A city can collapse during server downtime catch-up. Players should understand that the shared simulation is persistent.

## Known balance and measurement risks

| Risk | Why it matters | Evidence to collect | First tuning lever |
| --- | --- | --- | --- |
| Home-number inequality | 6/8 homes produce 66.7% faster than 4/10 | Mint/player/min by home number and role | Tile-number assignment, not global pulse speed |
| Grid Operator slow start | First Energy home is number 4 | First-action time and Energy stock | Starting home order or +1 starter Energy |
| Energy/Supply bottleneck | Lowest board-weighted supply; fund crisis actions | Stock, failed costs, blackout recovery | Tile weights or targeted NPC ratios |
| Runaway abundance | Several farms/reactors can pin meters at 100 | Meter saturation and unused stock | Building output or upkeep |
| Infrastructure debt spiral | Dead/disabled structures consume power demand | Power decline after damage | Count only living structures or add demolition |
| Shield rounding mismatch | Advertised 35% may not affect two damage | Damage packets with/without shield | Accumulate fractional damage or round once later |
| Non-stacking utility | Extra Medbays/Shields add little redundancy | Duplicate build rate and player regret | Stack with diminishing returns or explain cap |
| Threat cliff/death spiral | At 70 structures decay; at 75 stability loses 4; at 100 collapse | Tick-aligned decline timeline | Threshold spacing or recovery strength |
| Blackout RNG spikes | Several early eligible 7s can dominate a short run | Crisis interval distribution across many seeds | Grace period/cooldown, not dice fairness |
| District asymmetry | East/South disable five tiles vs four | Loss by district | Weighted district selection or board layout |
| NPC resource transformation | NPC accepts sink one resource and mint another | NPC net flow by resource | Template frequency/ratios |
| Offer not escrowed | Maker can spend goods; buyer then sees rejection | Failed accepts by reason | Reservation/escrow or clearer UI |
| Dominant opening | Farm/reactor may crowd out all other builds | First three structures by successful groups | Costs, initial reserves, crisis timing |
| Reset-based restock | Reset restores every player's starter inventory | Resets before collapse; resource jump | Restrict/reset consent and segment analytics |
| Cumulative analytics | Counters survive civilization reset | Incorrect per-run KPI denominators | Snapshot/export at reset or add run-scoped counters |
| Rolling history loss | 500 events/120 samples omit long runs | Oldest timestamp and run duration | External append-only export, not larger snapshots |

Do not solve a comprehension problem with a numerical buff. Pair state metrics with observation: what did the player think would happen, what did the UI show, and what did the server reject?

## Core analyst metrics

Use civilization as the experiment unit because players share outcomes.

- Activation: players with `firstActionAt` / new joins.
- Median and P75 time from `joinedAt` to first successful charged action.
- Action success rate and rejection reasons by role/action.
- Successful charged actions per active player-minute.
- Minted, spent, stock, and net flow per resource and player-minute.
- Player and NPC trade creation, acceptance, expiry, age, and exchange ratio.
- Food/power/stability/threat time below warning and critical thresholds.
- Population growth/loss, cap utilization, and first structure times.
- Blackout starts, manual-vs-timeout resolution, response seconds, and city delta.
- Survival time, collapse cause, role coverage, party size, and civilization number.
- Meter saturation: percentage of samples at 0 or 100, which exposes overly weak/strong tuning.

The current aggregate state does not contain stable categorical rejection reasons or a permanent event history. Preserve sanitized exports after each playtest and use raw counts alongside rates.

## Playtest worksheet

Copy one block per civilization. Freeze the goal and success criteria before play starts.

### Session metadata

| Field | Value |
| --- | --- |
| Date/time and timezone | |
| Build commit | |
| `configVersion` | |
| Civilization number | |
| RNG seed | |
| Server topology/device | |
| Planned duration | |
| Actual duration | |
| Facilitator/observer | |
| Scenario/hypothesis | |
| Pass criterion | |
| Guardrails | |

### Party

| Player alias | New/returning | Role | Home number | Joined at | First action (s) | Main goal | Friction observed |
| --- | --- | --- | ---: | --- | ---: | --- | --- |
| P1 | | | | | | | |
| P2 | | | | | | | |
| P3 | | | | | | | |
| P4 | | | | | | | |
| P5 | | | | | | | |

### Economy and action summary

| Metric | Materials | Water | Tech | Energy | Supply |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starting stock | | | | | |
| Minted | | | | | |
| Spent | | | | | |
| Ending stock | | | | | |
| Failed actions for shortage | | | | | |
| NPC net effect | | | | | |

| Action/build | Attempts | Successes | Median time | Main rejection/avoidance reason |
| --- | ---: | ---: | ---: | --- |
| Shelter | | | | |
| Hydro Farm | | | | |
| Reactor | | | | |
| Medbay | | | | |
| Grid Shield | | | | |
| Emergency Rations | | | | |
| Boost the Grid | | | | |
| Repair Network | | | | |
| Civic Relief | | | | |
| Resolve Blackout | | | | |

### City timeline

Record at least every two minutes and immediately before/after each crisis.

| Minute/event | Pop/cap | Food | Power | Stability | Threat | Health | Structures | Open trades | Observation |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Start | | | | | | | | | |
| 2:00 | | | | | | | | | |
| 4:00 | | | | | | | | | |
| Blackout | | | | | | | | | |
| End | | | | | | | | | |

### Crisis log

| # | District | Started | Resolved | Manual/auto | Response seconds | Resources available at start | City delta | What players did |
| ---: | --- | --- | --- | --- | ---: | --- | --- | --- |
| 1 | | | | | | | | |
| 2 | | | | | | | | |

### Qualitative debrief

- What did each player believe their role was responsible for?
- Which decision felt most meaningful?
- When did anyone feel idle, confused, or unable to help?
- Which meter or warning was noticed too late?
- Did a failed command feel fair and understandable?
- Did trading solve a real need or feel like overhead?
- Was the blackout response tense, trivial, or hopeless? Why?
- What strategy would the group repeat next time?
- One change players requested; evidence supporting or contradicting it:

### Outcome

| Result | Value |
| --- | --- |
| Alive/collapsed | |
| Survival minutes | |
| Collapse cause | |
| Minimum composite health | |
| Activation | |
| Action success | |
| Player trade conversion | |
| Blackout recovery | |
| Hypothesis passed? | |
| Guardrail violated? | |
| Recommended decision | keep / tune / instrument / retest |

## Tuning procedure

1. Validate instrumentation and invariants first. A duplicated payout is not a balance result.
2. Diagnose one constraint using event timing, resource flow, state samples, and observation.
3. State a falsifiable hypothesis and choose one primary metric plus guardrails.
4. Change one balance family only: pulse assignment/faucets, costs/sinks, timer cadence, tick pressure, building output, or crisis damage.
5. Re-run the same seed set/scenario on baseline and candidate. Include at least one ideal five-role party and one imperfect composition.
6. Compare raw numerators/denominators and effect size. Small internal samples are directional, not statistically conclusive.
7. Promote only if the target improves without a guardrail regression; otherwise revert or instrument the uncertainty.

Suggested early targets (starting hypotheses, not promises):

- At least 80% activation and P75 first action under 60 seconds in a five-player facilitated test.
- Action success between 65% and 95% after 20+ attempts; inspect reasons outside that range.
- At least 25% player-offer conversion after eight offers.
- At least 60% blackout recovery after three eligible crises, with manual recovery possible but not mandatory.
- Neither critical Energy nor Supply stock remains at zero for more than two consecutive minutes in a balanced party.
- Composite health does not fall more than 10 points across four samples without a visible, actionable cause.

## Tuning decision log

Keep one row per proposed or shipped adjustment. Never overwrite the baseline; increment `GAME_CONFIG.version` for any change that affects outcomes.

| Date | Owner | From -> to version | Evidence/run IDs | Problem and root-cause hypothesis | Exact change | Primary metric and expected movement | Guardrails | Seed/scenario/sample | Result | Decision/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | | | | | | | | | | |

Expanded decision note template:

```text
Decision ID:
Owner/date:
Baseline configVersion:
Candidate configVersion:
Observed problem:
Evidence (quantitative and qualitative):
Why this is balance rather than UX, instrumentation, or a defect:
Hypothesis:
Exact parameter/formula change:
Primary metric, current value, target, and minimum sample:
Guardrail metrics and stop conditions:
Fixed seeds/scenarios and party compositions:
Result with raw numerator/denominator and effect size:
Unexpected behavior:
Decision: ship / revise / reject / gather more data
Rollback trigger:
Next owner/date:
```
