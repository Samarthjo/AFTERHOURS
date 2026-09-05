import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIG } from "./config";
import type {
  AwaySummary,
  BuildingKey,
  CityActionKey,
  GameState,
  Player,
  ResourceAmount,
  RoleKey,
} from "./types";

type ConnectionStatus = "connecting" | "online" | "offline";

interface CommandResult {
  ok: boolean;
  message: string;
  playerId?: string;
}

interface ServerResult extends CommandResult {
  type: "result";
  requestId: string;
}

interface SnapshotMessage {
  type: "snapshot";
  state: GameState;
  serverNow: number;
}

type CommandPayload =
  | { type: "join"; name: string; role: RoleKey }
  | { type: "build"; playerId: string; building: BuildingKey; tileId: string }
  | { type: "city_action"; playerId: string; action: CityActionKey }
  | { type: "create_trade"; playerId: string; give: ResourceAmount; want: ResourceAmount }
  | { type: "accept_trade"; playerId: string; offerId: string }
  | { type: "cancel_trade"; playerId: string; offerId: string }
  | {
      type: "reset";
      confirmation: string;
      expectedCivilization: number;
      expectedRevision: number;
    };

const PLAYER_SESSION_KEY = "afterhours:current-player";
const LAST_PLAYER_KEY = "afterhours:last-player";
const VISIT_PREFIX = "afterhours:last-visit:";

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `${Date.now().toString(36)}-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readRememberedPlayer(): string | null {
  return sessionStorage.getItem(PLAYER_SESSION_KEY) ?? localStorage.getItem(LAST_PLAYER_KEY);
}

function calculateAwaySummary(state: GameState, playerId: string): AwaySummary | null {
  try {
    const raw = localStorage.getItem(`${VISIT_PREFIX}${playerId}`);
    if (!raw) return null;
    const previous = JSON.parse(raw) as { at: number; population: number };
    const elapsedMs = Date.now() - previous.at;
    if (!Number.isFinite(elapsedMs) || elapsedMs < GAME_CONFIG.tickMs * 1.5) return null;
    const events = state.events.filter((event) => event.at > previous.at);
    return {
      since: previous.at,
      elapsedMs,
      pulses: events.filter((event) => event.type === "pulse_resolved").length,
      ticks: events.filter((event) => event.type === "world_tick").length,
      trades: events.filter((event) => event.type === "trade_accepted").length,
      blackouts: events.filter((event) => event.type === "blackout_started").length,
      structures: events.filter((event) => event.type === "building_built").length,
      populationBefore: previous.population,
      populationAfter: state.world.population,
    };
  } catch {
    return null;
  }
}

export function useGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(() => readRememberedPlayer());
  const [awaySummary, setAwaySummary] = useState<AwaySummary | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const summarizedPlayerRef = useRef<string | null>(null);
  const pendingRef = useRef(new Map<string, {
    resolve: (result: CommandResult) => void;
    timeout: number;
  }>());

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    setConnection("connecting");
    const socket = new WebSocket(websocketUrl());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      reconnectAttemptRef.current = 0;
      setConnection("online");
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as SnapshotMessage | ServerResult;
        if (message.type === "snapshot") {
          setState(message.state);
          setServerOffset(message.serverNow - Date.now());
          return;
        }
        if (message.type === "result") {
          const pending = pendingRef.current.get(message.requestId);
          if (pending) {
            window.clearTimeout(pending.timeout);
            pending.resolve(message);
            pendingRef.current.delete(message.requestId);
          }
          setLastResult(message);
        }
      } catch {
        setLastResult({ ok: false, message: "The world sent an unreadable update." });
      }
    });

    socket.addEventListener("close", () => {
      if (!mountedRef.current) return;
      setConnection("offline");
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(5_000, 600 * 2 ** attempt);
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    });

    socket.addEventListener("error", () => socket.close());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      for (const pending of pendingRef.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ ok: false, message: "The connection closed before the action completed." });
      }
      pendingRef.current.clear();
    };
  }, [connect]);

  const currentPlayer = useMemo<Player | null>(() => {
    if (!state || !currentPlayerId) return null;
    return state.players.find((player) => player.id === currentPlayerId) ?? null;
  }, [currentPlayerId, state]);

  useEffect(() => {
    if (!state || !currentPlayerId) return;
    const exists = state.players.some((player) => player.id === currentPlayerId);
    if (!exists) {
      setCurrentPlayerId(null);
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
      return;
    }
    if (summarizedPlayerRef.current !== currentPlayerId) {
      setAwaySummary(calculateAwaySummary(state, currentPlayerId));
      summarizedPlayerRef.current = currentPlayerId;
    }
  }, [currentPlayerId, state]);

  useEffect(() => {
    if (!state || !currentPlayerId) return;
    const writeVisit = () => {
      localStorage.setItem(`${VISIT_PREFIX}${currentPlayerId}`, JSON.stringify({
        at: Date.now(),
        population: state.world.population,
      }));
    };
    window.addEventListener("pagehide", writeVisit);
    return () => {
      window.removeEventListener("pagehide", writeVisit);
      writeVisit();
    };
  }, [currentPlayerId, state]);

  const send = useCallback((payload: CommandPayload): Promise<CommandResult> => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      const result = { ok: false, message: "The city link is offline. Reconnecting…" };
      setLastResult(result);
      return Promise.resolve(result);
    }
    const requestId = createRequestId();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        const result = { ok: false, message: "The city did not confirm that action in time." };
        setLastResult(result);
        resolve(result);
      }, 8_000);
      pendingRef.current.set(requestId, { resolve, timeout });
      socket.send(JSON.stringify({ ...payload, requestId }));
    });
  }, []);

  const selectPlayer = useCallback((playerId: string) => {
    setCurrentPlayerId(playerId);
    sessionStorage.setItem(PLAYER_SESSION_KEY, playerId);
    localStorage.setItem(LAST_PLAYER_KEY, playerId);
    summarizedPlayerRef.current = null;
  }, []);

  const join = useCallback(async (name: string, role: RoleKey) => {
    const result = await send({ type: "join", name, role });
    if (result.ok && result.playerId) selectPlayer(result.playerId);
    return result;
  }, [selectPlayer, send]);

  const switchPlayer = useCallback(() => {
    setCurrentPlayerId(null);
    sessionStorage.removeItem(PLAYER_SESSION_KEY);
    localStorage.removeItem(LAST_PLAYER_KEY);
    summarizedPlayerRef.current = null;
    setAwaySummary(null);
  }, []);

  const clearAwaySummary = useCallback(() => setAwaySummary(null), []);
  const clearLastResult = useCallback(() => setLastResult(null), []);

  return {
    state,
    connection,
    serverNow: Date.now() + serverOffset,
    currentPlayer,
    currentPlayerId,
    awaySummary,
    clearAwaySummary,
    lastResult,
    clearLastResult,
    join,
    selectPlayer,
    switchPlayer,
    build: (building: BuildingKey, tileId: string) => currentPlayerId
      ? send({ type: "build", playerId: currentPlayerId, building, tileId })
      : Promise.resolve({ ok: false, message: "Join the city first." }),
    act: (action: CityActionKey) => currentPlayerId
      ? send({ type: "city_action", playerId: currentPlayerId, action })
      : Promise.resolve({ ok: false, message: "Join the city first." }),
    createTrade: (give: ResourceAmount, want: ResourceAmount) => currentPlayerId
      ? send({ type: "create_trade", playerId: currentPlayerId, give, want })
      : Promise.resolve({ ok: false, message: "Join the city first." }),
    acceptTrade: (offerId: string) => currentPlayerId
      ? send({ type: "accept_trade", playerId: currentPlayerId, offerId })
      : Promise.resolve({ ok: false, message: "Join the city first." }),
    cancelTrade: (offerId: string) => currentPlayerId
      ? send({ type: "cancel_trade", playerId: currentPlayerId, offerId })
      : Promise.resolve({ ok: false, message: "Join the city first." }),
    reset: () => state
      ? send({
          type: "reset",
          confirmation: "RESET AFTERHOURS",
          expectedCivilization: state.world.civilization,
          expectedRevision: state.world.revision,
        })
      : Promise.resolve({ ok: false, message: "The city state is not ready yet." }),
  };
}
