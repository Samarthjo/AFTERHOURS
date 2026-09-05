import express from "express";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  acceptTradeOffer,
  buildStructure,
  cancelTradeOffer,
  createInitialState,
  createTradeOffer,
  GAME_SCHEMA_VERSION,
  joinPlayer,
  performCityAction,
  processDueEvents,
  resetCivilization,
} from "../src/engine";
import { GAME_CONFIG } from "../src/config";
import { BUILDING_KEYS, RESOURCE_KEYS, ROLE_KEYS } from "../src/types";
import type {
  BuildingKey,
  CityActionKey,
  GameState,
  ResourceAmount,
  ResourceKey,
  RoleKey,
} from "../src/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const dataDir = path.join(projectRoot, "data");
const statePath = path.join(dataDir, "world-state.json");
const temporaryStatePath = path.join(dataDir, "world-state.tmp.json");
const port = Number(process.env.PORT ?? 8787);

type Command =
  | { type: "join"; requestId: string; name: string; role: RoleKey }
  | { type: "build"; requestId: string; playerId: string; building: BuildingKey; tileId: string }
  | { type: "city_action"; requestId: string; playerId: string; action: CityActionKey }
  | { type: "create_trade"; requestId: string; playerId: string; give: ResourceAmount; want: ResourceAmount }
  | { type: "accept_trade"; requestId: string; playerId: string; offerId: string }
  | { type: "cancel_trade"; requestId: string; playerId: string; offerId: string }
  | {
      type: "reset";
      requestId: string;
      confirmation: string;
      expectedCivilization: number;
      expectedRevision: number;
    }
  | { type: "ping"; requestId: string };

interface ResultMessage {
  type: "result";
  requestId: string;
  ok: boolean;
  message: string;
  playerId?: string;
}

async function writeStateSnapshot(snapshot: string): Promise<void> {
  await fs.writeFile(temporaryStatePath, snapshot, "utf8");
  await fs.rename(temporaryStatePath, statePath);
}

function eventCivilization(event: GameState["events"][number], fallback: number): number {
  if (Number.isInteger(event.civilization) && event.civilization > 0) return event.civilization;
  const idMatch = /^event-(\d+)-/.exec(event.id);
  if (idMatch) return Number(idMatch[1]);
  const fromData = event.type === "civilization_started" ? Number(event.data?.civilization) : Number.NaN;
  return Number.isInteger(fromData) && fromData > 0 ? fromData : fallback;
}

function migrateState(parsed: GameState): { state: GameState; migrated: boolean } {
  if (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1 || parsed.schemaVersion > GAME_SCHEMA_VERSION) {
    throw new Error(`Unsupported saved-state schema ${String(parsed.schemaVersion)}`);
  }
  if (parsed.configVersion !== GAME_CONFIG.version) {
    throw new Error(
      `Saved balance version ${String(parsed.configVersion)} does not match ${GAME_CONFIG.version}`,
    );
  }
  if (parsed.schemaVersion === GAME_SCHEMA_VERSION) return { state: parsed, migrated: false };

  const currentCivilization = parsed.world.civilization;
  parsed.events = parsed.events.map((event) => ({
    ...event,
    civilization: eventCivilization(event, currentCivilization),
    configVersion: event.configVersion || parsed.configVersion,
  }));

  const boundaries = parsed.events
    .filter((event) => event.type === "civilization_started")
    .map((event) => ({ at: event.at, civilization: eventCivilization(event, currentCivilization) }))
    .sort((left, right) => left.at - right.at);
  parsed.analytics.samples = parsed.analytics.samples.map((sample) => {
    const boundary = [...boundaries].reverse().find((candidate) => candidate.at <= sample.at);
    const inferredCivilization = boundary?.civilization
      ?? (sample.at >= parsed.world.createdAt ? currentCivilization : 1);
    return {
      ...sample,
      civilization: inferredCivilization,
      configVersion: parsed.configVersion,
    };
  });

  parsed.analytics.tradeOffersCreated += parsed.trades.filter((offer) => offer.npc).length;

  for (const resource of RESOURCE_KEYS) {
    const stock = parsed.players.reduce(
      (total, player) => total + Math.max(0, player.inventory[resource] ?? 0),
      0,
    );
    parsed.analytics.resourcesMinted[resource] = parsed.analytics.resourcesSpent[resource] + stock;
  }

  const recordedActivations = parsed.players.filter((player) => player.firstActionAt !== null).length;
  let missingActivationMarkers = Math.max(
    0,
    Math.min(parsed.analytics.firstActionSeconds.length, parsed.players.length) - recordedActivations,
  );
  for (const player of [...parsed.players].sort((left, right) => left.joinedAt - right.joinedAt)) {
    if (missingActivationMarkers === 0) break;
    if (player.firstActionAt === null) {
      player.firstActionAt = player.joinedAt;
      missingActivationMarkers -= 1;
    }
  }

  parsed.schemaVersion = GAME_SCHEMA_VERSION;
  return { state: parsed, migrated: true };
}

async function quarantineSavedState(error: unknown): Promise<void> {
  const quarantinePath = path.join(dataDir, `world-state.rejected-${Date.now()}.json`);
  try {
    await fs.rename(statePath, quarantinePath);
    console.warn(`Preserved incompatible world state at ${quarantinePath}.`, error);
  } catch (renameError) {
    console.warn("Saved world could not be loaded or preserved; starting a fresh civilization.", error, renameError);
  }
}

async function loadState(): Promise<GameState> {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as GameState;
    if (
      !parsed?.world
      || !Array.isArray(parsed.players)
      || !Array.isArray(parsed.trades)
      || !Array.isArray(parsed.events)
      || !parsed.analytics
      || !Array.isArray(parsed.analytics.samples)
    ) {
      throw new Error("Saved state did not match the current schema");
    }
    const migrated = migrateState(parsed);
    const state = processDueEvents(migrated.state, Date.now());
    if (migrated.migrated) {
      await writeStateSnapshot(JSON.stringify(state, null, 2));
      console.log(`Migrated persisted world state to schema ${GAME_SCHEMA_VERSION}.`);
    }
    return state;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      await quarantineSavedState(error);
    }
    const state = createInitialState(Date.now());
    await writeStateSnapshot(JSON.stringify(state, null, 2));
    return state;
  }
}

let gameState = await loadState();
let savePromise: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();
let lastPersistenceError: string | null = null;
let lastSavedAt = Date.now();

function persistState(candidate: GameState): Promise<void> {
  const snapshot = JSON.stringify(candidate, null, 2);
  const pendingWrite = savePromise
    .catch(() => undefined)
    .then(() => writeStateSnapshot(snapshot));
  savePromise = pendingWrite.then(
    () => {
      lastPersistenceError = null;
      lastSavedAt = Date.now();
    },
    (error: unknown) => {
      lastPersistenceError = error instanceof Error ? error.message : String(error);
      console.error("Unable to persist world state", error);
      throw error;
    },
  );
  return savePromise;
}

function enqueueMutation(task: () => Promise<void>): void {
  mutationQueue = mutationQueue
    .catch(() => undefined)
    .then(task)
    .catch((error) => console.error("World-state task failed", error));
}

function broadcastState(): void {
  const payload = JSON.stringify({ type: "snapshot", state: gameState, serverNow: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function send(socket: WebSocket, message: ResultMessage | { type: "snapshot"; state: GameState; serverNow: number }): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function cleanString(value: unknown, maxLength = 80): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isResource(value: unknown): value is ResourceKey {
  return typeof value === "string" && (RESOURCE_KEYS as readonly string[]).includes(value);
}

function parseAmount(value: unknown): ResourceAmount | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isResource(candidate.resource)) return null;
  const amount = Number(candidate.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 9) return null;
  return { resource: candidate.resource, amount };
}

function parseCommand(raw: string): Command | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const requestId = cleanString(value.requestId, 120);
    const type = cleanString(value.type, 40);
    if (!requestId) return null;

    if (type === "ping") return { type, requestId };
    if (type === "join") {
      const name = cleanString(value.name, 24).replace(/[<>]/g, "");
      const role = value.role;
      if (name.length < 2 || typeof role !== "string" || !(ROLE_KEYS as readonly string[]).includes(role)) return null;
      return { type, requestId, name, role: role as RoleKey };
    }
    if (type === "build") {
      const playerId = cleanString(value.playerId, 120);
      const tileId = cleanString(value.tileId, 40);
      const building = value.building;
      if (!playerId || !tileId || typeof building !== "string" || !(BUILDING_KEYS as readonly string[]).includes(building)) return null;
      return { type, requestId, playerId, tileId, building: building as BuildingKey };
    }
    if (type === "city_action") {
      const actions: CityActionKey[] = ["feed", "power", "repair", "stabilize", "restore_grid"];
      const playerId = cleanString(value.playerId, 120);
      const action = value.action;
      if (!playerId || typeof action !== "string" || !actions.includes(action as CityActionKey)) return null;
      return { type, requestId, playerId, action: action as CityActionKey };
    }
    if (type === "create_trade") {
      const playerId = cleanString(value.playerId, 120);
      const give = parseAmount(value.give);
      const want = parseAmount(value.want);
      if (!playerId || !give || !want || give.resource === want.resource) return null;
      return { type, requestId, playerId, give, want };
    }
    if (type === "accept_trade" || type === "cancel_trade") {
      const playerId = cleanString(value.playerId, 120);
      const offerId = cleanString(value.offerId, 120);
      if (!playerId || !offerId) return null;
      return { type, requestId, playerId, offerId };
    }
    if (type === "reset") {
      const expectedCivilization = Number(value.expectedCivilization);
      const expectedRevision = Number(value.expectedRevision);
      if (
        !Number.isSafeInteger(expectedCivilization)
        || expectedCivilization < 1
        || !Number.isSafeInteger(expectedRevision)
        || expectedRevision < 0
      ) return null;
      return {
        type,
        requestId,
        confirmation: cleanString(value.confirmation, 40),
        expectedCivilization,
        expectedRevision,
      };
    }
    return null;
  } catch {
    return null;
  }
}

const app = express();
app.disable("x-powered-by");
app.get("/api/health", (_request, response) => {
  response.status(lastPersistenceError ? 503 : 200).json({
    ok: lastPersistenceError === null,
    civilization: gameState.world.civilization,
    revision: gameState.world.revision,
    players: gameState.players.length,
    status: gameState.world.status,
    persistence: lastPersistenceError ? "degraded" : "healthy",
    lastSavedAt,
    error: lastPersistenceError,
  });
});

const distPath = path.join(projectRoot, "dist");
app.use(express.static(distPath));
app.get(/.*/, (_request, response, next) => {
  response.sendFile(path.join(distPath, "index.html"), (error) => {
    if (error) next();
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

wss.on("connection", (socket) => {
  enqueueMutation(async () => {
    const candidate = processDueEvents(gameState, Date.now());
    if (candidate.world.revision !== gameState.world.revision) {
      try {
        await persistState(candidate);
        gameState = candidate;
        broadcastState();
      } catch {
        // The previous durable snapshot remains authoritative.
      }
    }
    send(socket, { type: "snapshot", state: gameState, serverNow: Date.now() });
  });

  socket.on("message", (buffer) => {
    const command = parseCommand(buffer.toString());
    if (!command) {
      send(socket, { type: "result", requestId: "invalid", ok: false, message: "That command was not valid." });
      return;
    }
    if (command.type === "ping") {
      send(socket, { type: "result", requestId: command.requestId, ok: true, message: "pong" });
      return;
    }

    enqueueMutation(async () => {
      const now = Date.now();
      let result: { state: GameState; ok: boolean; message: string } | null = null;
      let playerId: string | undefined;

      switch (command.type) {
        case "join": {
          const beforeIds = new Set(gameState.players.map((player) => player.id));
          result = joinPlayer(gameState, command.name, command.role, now);
          playerId = result.state.players.find((player) => !beforeIds.has(player.id))?.id
            ?? result.state.players.find((player) => player.name.toLocaleLowerCase() === command.name.toLocaleLowerCase())?.id;
          break;
        }
        case "build":
          result = buildStructure(gameState, command.playerId, command.building, command.tileId, now);
          break;
        case "city_action":
          result = performCityAction(gameState, command.playerId, command.action, now);
          break;
        case "create_trade":
          result = createTradeOffer(gameState, command.playerId, command.give, command.want, now);
          break;
        case "accept_trade":
          result = acceptTradeOffer(gameState, command.playerId, command.offerId, now);
          break;
        case "cancel_trade":
          result = cancelTradeOffer(gameState, command.playerId, command.offerId, now);
          break;
        case "reset":
          if (command.confirmation !== "RESET AFTERHOURS" && gameState.world.status !== "collapsed") {
            send(socket, { type: "result", requestId: command.requestId, ok: false, message: "Reset confirmation did not match." });
            return;
          }
          if (
            command.expectedCivilization !== gameState.world.civilization
            || command.expectedRevision !== gameState.world.revision
          ) {
            send(socket, {
              type: "result",
              requestId: command.requestId,
              ok: false,
              message: "The world changed before reset. Review the latest city state and try again.",
            });
            return;
          }
          result = { state: resetCivilization(gameState, now), ok: true, message: "A new civilization has begun." };
          break;
      }

      if (!result) {
        send(socket, { type: "result", requestId: command.requestId, ok: false, message: "The command could not be completed." });
        return;
      }

      try {
        await persistState(result.state);
      } catch {
        send(socket, {
          type: "result",
          requestId: command.requestId,
          ok: false,
          message: "The action was not saved, so the world did not apply it. Check server storage and retry.",
        });
        return;
      }

      gameState = result.state;
      broadcastState();
      send(socket, {
        type: "result",
        requestId: command.requestId,
        ok: result.ok,
        message: result.message,
        playerId,
      });
    });
  });
});

setInterval(() => {
  enqueueMutation(async () => {
    const candidate = processDueEvents(gameState, Date.now());
    if (candidate.world.revision === gameState.world.revision) return;
    try {
      await persistState(candidate);
      gameState = candidate;
      broadcastState();
    } catch {
      // Retry from the last durable state on the next interval.
    }
  });
}, 1_000).unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`AFTERHOURS world server listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  const forceExit = setTimeout(() => process.exit(1), 1_500);
  forceExit.unref();
  await mutationQueue;
  try {
    await persistState(gameState);
  } catch {
    // The health endpoint and logs already expose the failed durable write.
  }
  await savePromise.catch(() => undefined);
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
