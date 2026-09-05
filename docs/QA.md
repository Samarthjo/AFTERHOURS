# AFTERHOURS QA and release checklist

This plan covers the browser client, authoritative Node/WebSocket server, simulation, persistence, and multiplayer failure modes. A release is not complete merely because one browser can render the board: shared-state invariants, restart behavior, and competing commands are the highest-risk areas.

## Release gates

A candidate is releasable when all of the following are true:

- `npm test` passes from a clean `npm ci` install.
- `npm run build` completes without TypeScript errors.
- `npm start` serves the built UI and accepts `/ws` connections on port 8787.
- The smoke path works in two independent browser sessions.
- The concurrency, restart-persistence, and six-hour catch-up-cap cases pass.
- No critical keyboard trap, unreadable mobile control, or color-only game state remains.
- The server logs no unhandled rejection, uncaught exception, repeated persistence error, or timer backlog during the test run.

Record the commit, config version, Node/browser versions, starting state, and resulting `data/world-state.json` hash with every formal run.

## Recommended test matrix

| Area | Minimum coverage |
| --- | --- |
| Desktop | Current Chrome/Edge and Firefox; one Safari run before a public release |
| Mobile | iOS Safari and Android Chrome on real hardware; narrow responsive emulation as a fast pre-check |
| Viewports | 320x568, 390x844, 768x1024, 1366x768, and 1920x1080 |
| Input | Mouse, touch, keyboard only, and screen reader spot-check |
| Network | Normal, high latency (300-800 ms), intermittent loss, offline, server restart, reconnect storm |
| Topology | One tab, two tabs, two profiles, two devices on a LAN, 25+ scripted WebSocket clients |
| State | Fresh file, active mature city, active blackout, near-collapse, collapsed world, old/corrupt persistence fixture |

Use separate browser profiles or private windows for distinct players. `sessionStorage` can be copied when a tab is duplicated, so two ordinary tabs are not guaranteed to represent two different identities.

## Automated-test priorities

Use a fixed clock and seed wherever possible. Assert state and invariants rather than DOM animation timing.

1. Pure simulation tests: 2d6 resolution, tick formulas, buildings, blackouts, catch-up, collapse, and caps.
2. Command-validation tests: joins, action charge, affordability, trade lifecycle, reset authorization/state, and malformed payloads.
3. Persistence tests: serialize/reload equivalence, atomic replacement, schema/config handling, and downtime catch-up.
4. WebSocket integration tests: initial snapshot, broadcast, reconnect, competing commands, and stale/invalid messages.
5. Component tests: onboarding, HUD thresholds, disabled reasons, dialog focus, and responsive navigation.

Keep a deterministic fixture for each major state. Never make the main suite depend on the wall clock or on whichever `data/world-state.json` happens to be in the working tree.

## Functional cases

### Boot, connection, and onboarding

- **Fresh boot:** With no world file, start the server. Verify one valid civilization is created, persisted, and broadcast with the expected `schemaVersion` and `configVersion`.
- **Initial snapshot:** Open the UI. Verify the connection indicator settles, exactly one canonical snapshot is rendered, and no client-side pulse or tick changes state before a server update.
- **Join:** Enter a valid display name and choose each of the five roles in turn. Verify the player is created once, starts with that role's exact inventory, and receives a server ID plus the least-occupied home tile for the role's specialty.
- **Input boundaries:** Try empty, whitespace-only, very long, Unicode, emoji, HTML, and script-like names. Verify safe validation and text rendering; no markup executes and layout does not break.
- **Invalid role/home override:** Send a forged join payload with an unknown role and verify rejection. Add a client-supplied home-tile field pointing at the Civic Core/nonexistent tile and verify it is ignored; only the server chooses a valid specialty tile.
- **Duplicate submit:** Double-click or press Enter repeatedly while joining. Verify a single player record and a single join event.
- **Refresh/reconnect:** Refresh after joining. Verify the stored current-player identity reattaches to the same server player rather than minting starter inventory again.
- **Identity across reset:** Reset the civilization from another client, then reconnect with a remembered player ID. Verify the same roster entry remains selected with reset starter inventory/action fields. Separately load a state that truly lacks the remembered ID and verify a clean onboarding/player-selection path.
- **Escaping:** Verify names are safely displayed in the player list, trade cards, events, and analytics views.

### Map and resource pulses

- Verify the board contains the Civic Core plus all configured resource tiles, with correct district, resource, and pulse number.
- For every possible 2d6 sum (2-12), inject/force the roll and verify `lastPulseRoll`, `activePulseNumber`, and `activeTileIds` agree with `src/config.ts`.
- Verify sums 2, 3, 7, 11, and 12 activate no resource tile and mint nothing.
- Verify one pulse is resolved exactly once even if several clients connect, reconnect, or send commands at the boundary.
- Verify every eligible occupant of an active tile receives the intended payout once, ineligible players receive none, and `resourcesMinted`/events match the inventory delta.
- Verify a pulse that activates several tiles broadcasts one internally consistent revision; clients must not briefly mix the old inventory with new active tiles.
- Run at least 10,000 seeded pulses. Confirm the empirical sum distribution is close to 2d6 expectations and no impossible value occurs.
- Sleep/background a browser for several pulses, then foreground it. Verify the browser adopts the current server snapshot and does not replay client-side payouts.

### World ticks and survival meters

- From a fixed state with no structures, advance one tick and assert exact population, cap, food, power, stability, health, and threat deltas.
- Repeat with one and several farms, reactors, shelters, medbays, and shields. Verify additive effects and every documented cap/floor.
- Verify the population cap is base 50 plus 25 per valid shelter, and population never grows beyond it.
- Drive food and power independently just above, at, and below shortage thresholds. Verify boundary behavior is deliberate and deterministic.
- Verify the medbay reduces only the intended shortage population loss and does not silently reduce unrelated damage.
- Verify the Grid Shield applies the intended 35% crisis-damage reduction once, with a documented stacking rule if several exist.
- Verify structure health, overall building health, stability, population, and threat cannot become `NaN`, infinite, negative where prohibited, or exceed their caps.
- Verify collapse happens once at the documented terminal threshold, timers stop or change behavior as designed, and no post-collapse command mutates the dead civilization except reset.

### Action charge and commands

- On join, verify the first action is available according to the intended onboarding rule.
- Execute each build and city action with exact cost. Verify one charge and the exact inventory cost are consumed, the effect is applied once, contribution/action counters update, and an event is emitted.
- Retry immediately. Verify server rejection with a useful reason and no inventory, contribution, analytics-success, or revision change beyond any deliberately logged rejection.
- Retry at 11.999 seconds, 12.000 seconds, and just after 12 seconds using a controlled clock. Verify one unambiguous refill boundary.
- Send a command with insufficient resources, negative/decimal/overflow amounts, an invalid action/building key, invalid tile, stale player, and malformed JSON. Verify safe rejection and no server crash.
- Attempt a normal city action while collapsed; attempt `restore_grid` while no blackout is active. Verify clear rejection.
- Build on every legal and illegal target, including any occupied/disabled/core tile. Verify placement rules are enforced server-side.
- Verify the action button's disabled appearance and explanation match server eligibility, while still treating the server as final authority.

### Buildings

- Build each structure and compare the deducted inventory with the exact config cost.
- Verify a structure has a unique ID, correct `tileId`, `builtBy`, level, health, and `builtAt`.
- Verify duplicate placement or multiple structures on one tile follows the intended rule and cannot be bypassed with simultaneous requests.
- Damage a structure, then repair. Verify `Repair Network` selects the weakest eligible structure deterministically and clamps at maximum health.
- Tie two weakest structures and confirm a deterministic tie-break, so restart/replay cannot choose a different target.
- Destroy or fully damage structures and verify their effects enable/disable at the intended health threshold.

### Trades

- Create offers for every give/want resource pair and boundary amount. Verify positive integer validation, affordability, expiry time, analytics, and event content.
- Verify a player cannot give more than owned, trade with themselves where prohibited, create a zero-for-zero offer, or inject an unknown resource.
- Verify the chosen escrow rule: either inventory is reserved at creation, or acceptance atomically rechecks the maker's balance. Spending elsewhere must never create resources or a negative balance.
- Accept a valid offer from another player. Verify both inventory transfers are atomic, status becomes `accepted`, `acceptedBy` is set, and no second acceptance succeeds.
- Let an offer reach just before, exactly at, and just after 120 seconds. Verify a single, deterministic expiry transition and correct return of escrow if applicable.
- Cancel an offer as maker and attempt cancellation as another player. Verify authorization, inventory handling, and status.
- Exercise NPC offers separately. Verify their creation/expiry policy, affordability semantics, and resource effect are visible in analytics; NPC activity must not create unbounded inflation unnoticed.
- Reconnect maker and buyer mid-trade. Verify canonical status and balances survive.

### Blackouts and collapse

- Force blackout eligibility immediately before and after the 120-second cooldown boundary.
- Verify a blackout chooses a valid district, starts once, disables exactly the announced tile IDs, records start/end time, increments analytics, and emits one event.
- Verify disabled tiles do not produce during matching pulses.
- Let the full 75 seconds elapse. Verify automatic resolution happens once, tiles re-enable, cooldown is set, and the resolution is broadcast/persisted.
- Resolve early with exact tech + energy cost. Verify action charge/cost, resolution counters, grid effect, cooldown, and event are applied once.
- Have two players resolve the same blackout simultaneously. Verify exactly one succeeds and exactly one resource cost is paid.
- Test crisis damage with zero, one, and multiple Grid Shields; test population loss with zero, one, and multiple Medbays.
- Restart the server during an active blackout and after its scheduled end. Verify persisted timestamps yield the same outcome as uninterrupted simulation.
- Drive the city to collapse through each supported failure condition. Verify one collapse event and a stable terminal state.

### New civilization and reset

- From a collapsed world, select **Start New Civilization** and confirm one fresh world with incremented civilization/run identity, reset timers, no structures/trades, the existing roster restored to role starter inventories, and valid remembered player identities. Verify cumulative analytics/events remain available and are segmented by civilization.
- Verify the collapsed-world action cannot be double-submitted by two clients to create two successive civilizations.
- Select the footer's **New civilization** control while alive. Verify the confirmation clearly says it affects every player; cancel leaves state untouched.
- Confirm reset. Verify it is a server command, affects all connected clients, persists immediately, and cannot leave old timers running.
- Attempt forged, repeated, and stale reset commands. Verify intended authorization and idempotency.

## Concurrency and multiplayer cases

For each race below, synchronize clients to send on the same millisecond and repeat at least 100 times. Assert resource conservation and one canonical result—not merely that the UI looks plausible.

| Race | Required invariant |
| --- | --- |
| Same player acts from two tabs | At most one action consumes the ready charge |
| Two players build on one exclusive tile | At most one legal structure occupies it |
| Two buyers accept one offer | Exactly one acceptance and one atomic exchange |
| Maker spends while buyer accepts | No negative inventory; one serialized outcome |
| Two players resolve a blackout | One resolution and one payment |
| Pulse/tick and player action share a timestamp | Deterministic serialized result; no lost update |
| Expiry and acceptance share a timestamp | Exactly one terminal trade status |
| Reset and ordinary command race | Command belongs wholly to old or new civilization, never both |
| Persistence write and server shutdown overlap | Last acknowledged revision is recoverable or failure is explicit |

Additional checks:

- Revisions received by each connected client are monotonically increasing. A delayed older snapshot must never overwrite a newer one.
- Connect/disconnect 25 clients during a tick. Verify the tick resolves once and session/reconnect counts follow documented semantics.
- Kill one browser during a command send and reconnect. Verify the command is either accepted once or rejected/not accepted, never duplicated by an automatic resend without an idempotency key.
- Send valid commands from one client at high rate. Verify per-player cooldown/validation protects the world and one abusive connection cannot starve ticks for all players.
- Verify player `lastSeenAt` and online presentation tolerate clock skew because authoritative timestamps come from the server.

## Persistence and offline cases

### Browser offline/reconnect

- Disconnect the browser while the server stays up. Verify a clear offline indicator, no false success toast, and no client-owned mutation of the world.
- Attempt actions offline. Verify controls reject/disable them or clearly mark them unsent; reconnect must not silently burst stale destructive commands.
- Reconnect after several pulses/ticks. Verify one current snapshot replaces stale UI and current-player identity is restored when still valid.
- Simulate flapping connectivity. Verify bounded reconnect backoff, no connection leak, and no duplicate event handlers.

### Server restart and catch-up

- Stop after an acknowledged mutation, restart immediately, and compare every persisted field.
- Stop for 14, 15, 19, 20, 60, and 121 seconds. On restart, verify the exact expected count/order of pulses, ticks, trade expiries, and blackout transitions.
- Stop during an active blackout and across a trade expiry boundary. Verify deterministic resolution.
- Repeat a downtime fixture twice from the same JSON file and fixed seed/time. Resulting state must be byte-equivalent after canonical serialization or deeply equivalent if timestamps differ by design.
- Stop for just under, exactly, and over six hours. Verify catch-up work is capped at `maxOfflineMs`; startup time and event volume remain bounded.
- Verify catch-up respects the 500-event and 120-sample caps and cannot exhaust memory with one record per missed millisecond.
- Make `data/` read-only or fill its volume in a disposable environment. Verify a visible server error; do not acknowledge mutations as durable if the implementation promises durability.
- Feed truncated JSON, invalid JSON, unknown `schemaVersion`, and an older `configVersion`. Verify fail-safe behavior and preservation/quarantine of the bad file rather than silent destructive reset.
- Send SIGTERM during normal operation. Verify timers stop, latest state flushes if supported, sockets close, and restart does not double-process the final interval.

## Mobile and responsive cases

- At 320 CSS pixels wide, verify no horizontal page overflow, clipped modal, unreachable confirm button, or text smaller than the design minimum.
- Verify map pan/scroll does not trap the page and that a vertical page gesture is distinguishable from intentional map interaction.
- Touch every tile and primary action with a finger; interactive targets should be at least roughly 44x44 CSS pixels and not depend on hover.
- Rotate during onboarding, an open trade form, and an active blackout. Verify entered data and dialog state survive layout change.
- Test mobile browser chrome expanding/collapsing and safe-area insets; critical bottom controls must remain reachable.
- With 200% browser zoom and large OS text, verify HUD values wrap/reflow rather than overlap.
- Verify countdowns do not update so aggressively that they cause layout jitter or excessive battery use.
- Exercise a slow phone during a map-wide pulse animation. Server state must remain correct even if presentation drops frames.

## Accessibility cases

- Complete onboarding, one trade, one build, one city action, blackout restoration, Settings cancellation, and collapsed reset using keyboard only.
- Ensure logical focus order, visible focus, and no focus trap outside an intentional modal. On modal close, restore focus to the opener.
- Give every icon-only control and resource abbreviation an accessible name. Hexes must expose district, number, resource, state, and selection—not only a decorative SVG path.
- Announce connection changes, command success/failure, blackout start/end, and collapse without stealing focus. Do not announce every countdown second.
- Verify food, power, stability, threat, active tiles, scarcity, and disabled state are not communicated by color alone.
- Check text and meaningful UI contrast against WCAG AA targets; include focus indicators and disabled-but-readable explanations.
- With `prefers-reduced-motion`, remove or shorten nonessential pulse, shake, glow, and transition effects while retaining state feedback.
- Check screen-reader heading hierarchy, landmarks, form labels, validation messages, table semantics, and modal name/description.
- At 400% zoom, verify reflow without two-dimensional scrolling except for the map where spatial scrolling is essential.
- Pause on any time-sensitive form: trade creation must not expire while merely being composed, and the user must receive a clear server rejection if state changed before submit.

## Load, soak, and resilience cases

### Baselines

Capture server CPU, resident memory, event-loop delay, open sockets, messages/second, snapshot bytes, tick duration, and persistence-write duration. Use a copy of data, never a valued live world.

- **Connection load:** Ramp to 25, 100, then the intended launch concurrency. All receive an initial snapshot without blocking the next tick.
- **Command burst:** Send mixed valid/invalid actions and trade commands. The server remains responsive and validation errors are bounded.
- **Broadcast size:** Populate 500 events, 120 samples, many players/trades/structures, then measure snapshot size and broadcast latency.
- **Reconnect storm:** Drop and reconnect all clients with jitter. Verify backoff and no thundering-herd crash.
- **Soak:** Run for at least 8 hours (longer before public launch) through many pulses, ticks, offers, and blackouts. Memory and timer lag should stabilize rather than trend upward.
- **Slow consumer:** Throttle one socket. It must not grow an unbounded send buffer or delay healthy clients.
- **Malformed client:** Fuzz message type, size, JSON depth, numbers, IDs, and unknown fields. Verify clean close/rejection, not process failure.
- **Disk pressure:** Delay writes and simulate failure. Verify logged/observable behavior and no corrupt replacement of the last good snapshot.
- **Single-process constraint:** Confirm deployment runs exactly one world process against a JSON file. Starting two replicas must be prevented operationally or flagged as unsupported.

Suggested provisional service targets for a small playtest (tighten after measuring):

- p95 accepted-command-to-snapshot latency below 250 ms on the same LAN and below 750 ms over the intended internet path.
- Tick/pulse event-loop lag below 250 ms at expected concurrency.
- No sustained memory growth above 10% after the first hour of an eight-hour stable-load soak.
- Restart plus maximum six-hour catch-up completes within 10 seconds on target hardware.
- Zero lost/duplicated resources in concurrency invariant tests.

## Analytics and data-integrity checks

The persisted `AnalyticsState` is an operational summary. Verify it against event/state deltas:

- `sessions`, `joins`, and `reconnects` follow explicitly documented definitions.
- `actionAttempts >= actionSuccesses`; rejected actions never increment successes.
- Created, accepted, cancelled, and expired trade states reconcile with offer/event counters.
- `blackoutsStarted >= blackoutsResolved`, with at most one active blackout explaining a difference of one.
- `resourcesMinted - resourcesSpent` reconciles with player inventories after accounting for starting inventory and any explicitly logged NPC sources/sinks.
- Each player records `firstActionAt` once; `firstActionSeconds` contains finite nonnegative values.
- Time-series samples are chronological, contain finite values, and retain no more than 120 entries.
- Events retain no more than 500 entries, use the active config version, and do not contain secrets or raw network metadata.

For balancing analysis, export a sanitized state/event snapshot immediately after each playtest. The rolling buffers are not enough for long-term cohort analysis.

## Exploratory playtest script

1. Start from a fresh civilization with five players, one per role.
2. For two minutes, avoid trading; record confusion, idle time, and shortages.
3. Begin trading and construct one of each building; record the order and why players chose it.
4. Force or wait for a blackout. Let one run for its full duration and resolve another early.
5. Deliberately cause a food shortage, then recover; repeat for power.
6. Disconnect two players for three minutes and have them return.
7. Restart the server during an active offer/blackout.
8. Play to collapse or for 30 minutes, then exercise the new-civilization flow.
9. Complete the worksheet in `docs/BALANCE.md` and attach logs/screenshots to every defect.

## Defect template

```text
Title:
Severity: blocker / critical / major / minor / polish
Build commit and configVersion:
Environment and topology:
Starting fixture/revision:
Steps:
Expected:
Actual:
First bad server revision:
Relevant player/trade/structure IDs:
Console/server log excerpt:
Persistence file preserved at:
Repro rate:
```

Never attach a live world file publicly without first removing player-entered names and reviewing the event log.
