# AFTERHOURS

AFTERHOURS is a real-time, cooperative city-survival strategy game. Players join the same civilization, claim a role and home hex, collect resources when a 2d6 pulse activates their tile, trade with one another, build infrastructure, and spend scarce supplies to keep the population alive through shortages and blackouts.

The linked Shipstatic experience is the product and visual reference. This repository is a server-authoritative implementation of that concept: the shared world lives on one Node server, not in an individual browser.

## Gameplay at a glance

1. Connect to the world and join with a display name and role. The server assigns the least-occupied home tile that produces that role's specialty.
2. Every 15 seconds the server rolls 2d6. Numbered hexes matching the sum activate and produce their resource for eligible players.
3. Every 20 seconds the world advances. Population needs food and power; buildings produce resources or soften crises; shortages reduce stability, population, and structural health.
4. Spend an action charge to build, feed the city, boost the grid, repair, stabilize, or resolve a blackout. The charge refills 12 seconds after use; posting and accepting trades is free.
5. Coordinate rather than hoard. Each role starts with a different inventory, and the board produces water and tech more often than energy and supply.
6. If the civilization collapses, review the run and start a new civilization together.

This is an ongoing survival game, not a turn-based match. A brand-new empty civilization waits safely for its first citizen; after that first join, timers continue on the authoritative server even when no browser is open. If the server itself has been stopped, restart catch-up is deterministic and capped at six hours.

## Roles and resources

| Role | Specialty | Starting inventory (MAT/WTR/TEC/ENG/SUP) |
| --- | --- | --- |
| Architect | Materials; shelter and infrastructure | 3 / 1 / 1 / 0 / 1 |
| Cultivator | Water; food and growth | 1 / 3 / 0 / 1 / 1 |
| Systems Engineer | Tech; repair and advanced structures | 2 / 1 / 2 / 1 / 0 |
| Grid Operator | Energy; power and blackout response | 1 / 1 / 1 / 2 / 1 |
| Civic Medic | Supply; protecting population during failure | 1 / 1 / 1 / 0 / 3 |

Every role begins with six total resource units, but no role can comfortably cover every need alone.

## Structures and city actions

The five structures create the long-term engine of the city:

| Structure | Cost (MAT/WTR/TEC/ENG/SUP) | Effect |
| --- | --- | --- |
| Shelter | 2 / 1 / 0 / 0 / 0 | +25 population capacity |
| Hydro Farm | 1 / 2 / 0 / 0 / 0 | +7 food per world tick |
| Reactor | 2 / 1 / 2 / 0 / 0 | +8 power per world tick |
| Medbay | 0 / 1 / 1 / 0 / 1 | 50% lower population loss from shortages |
| Grid Shield | 2 / 0 / 1 / 1 / 0 | 35% less crisis damage |

Immediate city actions trade inventory for recovery:

| Action | Cost | Effect |
| --- | --- | --- |
| Emergency Rations | 1 supply | +22 food and +2 stability |
| Boost the Grid | 1 energy | +22 power and -6 threat |
| Repair Network | 1 materials + 1 tech | +28 health to the weakest structure |
| Civic Relief | 1 water + 1 supply | +15 stability and +5 food |
| Resolve Blackout | 1 tech + 1 energy | Ends the active blackout early and stabilizes the grid |

The definitive numbers live in [`src/config.ts`](src/config.ts). Design reasoning and probability tables are in [`docs/BALANCE.md`](docs/BALANCE.md).

## Features

- One persistent shared civilization with server-authoritative commands and snapshots.
- A 19-hex axial map: 18 resource tiles around the Civic Core, grouped into four outer districts.
- Deterministic 2d6 resource pulses and real-time world ticks.
- Five asymmetric roles, resources, buildings, and cooperative recovery actions.
- Player-to-player and NPC trade offers with expiry.
- District blackouts, early restoration, structural damage, collapse, and civilization reset.
- Reconnection and deterministic server catch-up after downtime, capped at six hours.
- An event feed and aggregate analytics for joins, actions, trades, resources, crises, reconnects, and time to first action.
- Responsive mouse, keyboard, and touch UI.

## Run locally

### Prerequisites

- A current Node.js LTS release (Node 22 is recommended).
- npm, included with Node.js.

Install the locked dependencies:

```bash
npm ci
```

Start the frontend and authoritative world server together:

```bash
npm run dev
```

- Frontend: `http://127.0.0.1:4173`
- World/API server: `http://127.0.0.1:8787`
- WebSocket endpoint in development: `ws://127.0.0.1:4173/ws` (proxied by Vite to port 8787)

Useful individual commands:

```bash
npm run dev:web   # Vite only; useful when a server is already running
npm run server    # authoritative server only
npm run test:watch
```

Do not use `npm run dev:web` by itself for a normal play session: the UI can render, but shared commands need the world server.

## Build and test

Run the automated suite once:

```bash
npm test
```

Create a type-checked production frontend build:

```bash
npm run build
```

Serve the built frontend and `/ws` from the authoritative server:

```bash
npm start
```

Then open `http://127.0.0.1:8787`. The server must be started from a checkout that contains the generated `dist/` directory.

See [`docs/QA.md`](docs/QA.md) for the manual release matrix, concurrency scenarios, and acceptance checks.

## Architecture

```text
React/Vite browser(s)
  - renders snapshots
  - sends player commands
  - keeps a tab/session player identity plus last-player and last-visit hints in browser storage
             |
             | same-origin HTTP + WebSocket /ws
             v
Node + Express + ws authoritative server
  - validates and serializes commands
  - owns RNG, timers, revisions, and analytics
  - broadcasts canonical snapshots
  - catches up deterministically after server downtime
             |
             v
data/world-state.json
  - durable shared-world snapshot
```

Key code boundaries:

- [`src/types.ts`](src/types.ts): shared state, command-adjacent, event, trade, player, and analytics contracts.
- [`src/config.ts`](src/config.ts): versioned balance constants, role loadouts, building/action costs, and map definition.
- [`src/`](src/): React client and presentation code. It never decides whether a shared action succeeds.
- [`server/`](server/): authoritative simulation, command validation, persistence, WebSocket transport, and production static serving.
- `data/world-state.json`: generated runtime state. Treat it as data, not source code.

Every event-producing world mutation advances the server revision. Revisions are monotonic within a civilization and restart for the next civilization. Clients replace their rendered state with canonical snapshots; they must not independently advance shared timers or resolve competing actions.

## Multi-tab and multi-device play

Multiple tabs, windows, and devices can join the same world while they can reach the same server. The server serializes simultaneous commands, so two clients cannot legitimately spend the same inventory, accept the same trade, consume the same action charge, or resolve the same blackout twice.

The current player identifier is stored in `sessionStorage`, with a last-player fallback and away-summary timestamp in `localStorage`. A fresh tab in the same browser profile can therefore reopen the most recently selected player, and duplicating a tab may copy session storage. These values are reconnect hints only—the server still validates the player and every command. Use separate browser profiles or private windows when manually testing distinct players on one computer.

For LAN testing, expose the frontend/server on an address reachable from the other device and allow the chosen port through the host firewall. Use the production server on port 8787 for the simplest same-origin setup. Do not expose an unencrypted development server to the public internet.

## Persistence, catch-up, and reset

- The canonical world is persisted to `data/world-state.json` by the Node server.
- Browser storage is not a backup of the world. Clearing it forgets player-selection and last-visit hints but does not change the shared city.
- Restarting the server reloads the file and deterministically applies elapsed simulation work. Catch-up processes at most `maxOfflineMs` (six hours), preventing an unbounded restart loop.
- A normal browser refresh reconnects and requests the current snapshot; it does not reset or fork the civilization.
- When the world is collapsed, **Start New Civilization** creates the next run.
- The footer's **New civilization** control is a destructive shared-world action and requires confirmation. It increments the civilization, clears structures and prior trades (then seeds fresh NPC offers), restores every existing player to their role's starter inventory, and resets their action/contribution fields. The player roster and cumulative analytics/event buffers remain.

For a clean development reset while the server is stopped, preserve the old state if it matters, then move `data/world-state.json` out of the project and restart the server. Avoid editing the JSON by hand: invalid or partially edited state can violate schema and balance-version assumptions.

## Deployment

1. Run `npm ci`, `npm test`, and `npm run build`.
2. Deploy the application with its Node dependencies, `server/` source, `dist/` output, and a writable persistent `data/` directory.
3. Start one authoritative process with `npm start` (port 8787 by default).
4. Put a TLS reverse proxy in front of the process for internet use. It must forward normal HTTP and WebSocket upgrade requests on `/ws`.
5. Back up the persistent data volume and monitor disk-write errors, reconnect rate, tick lag, and process restarts.

A static host such as Shipstatic can serve the built frontend, but a static upload alone cannot run this implementation's authoritative world, WebSocket endpoint, or JSON persistence. Either run the Node server separately and configure the client to reach it, or serve `dist/` directly from the Node process as designed.

The JSON adapter is intentionally simple and supports one authoritative server process. Horizontal replicas would race on the same world file. For a public, multi-region, or independently hosted version, replace the storage/transport boundary with a transactional shared backend such as SpacetimeDB before scaling beyond one process.

## Data and operations notes

- `schemaVersion` protects the persisted shape; schema 1 is migrated to schema 2 on startup. `configVersion` identifies the tuning set that produced every event and sample. An incompatible balance-version file is preserved as `data/world-state.rejected-*.json` before a fresh world is created.
- The in-state event log is capped at 500 entries and the time-series sample window at 120 entries. These are operational buffers, not a permanent analytics warehouse.
- Never commit a live `data/world-state.json` containing player-entered names without reviewing it.
- If durable historical analysis is required, export sanitized events to an append-only store rather than increasing the in-memory caps indefinitely.
