import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  BUILDINGS,
  CITY_ACTIONS,
  GAME_CONFIG,
  RESOURCE_META,
  ROLE_META,
  TILES,
} from "./config";
import { useGame } from "./useGame";
import {
  buildAnalyticsCsv,
  buildAnalyticsJson,
  buildKpiSnapshot,
  cityHealthScore,
  getBalanceWarnings,
} from "./analytics";
import {
  BUILDING_KEYS,
  RESOURCE_KEYS,
  ROLE_KEYS,
  type AwaySummary,
  type BuildingKey,
  type CityActionKey,
  type GameEvent,
  type GameState,
  type Inventory,
  type Player,
  type ResourceKey,
  type RoleKey,
  type Tile,
  type TradeOffer,
} from "./types";

type View = "city" | "market" | "analyst";

let audioContext: AudioContext | null = null;

function playTone(kind: "success" | "error" | "pulse") {
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = kind === "error" ? "sawtooth" : "sine";
    oscillator.frequency.value = kind === "success" ? 620 : kind === "pulse" ? 340 : 180;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, audioContext.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.18);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch {
    // Audio feedback is an enhancement; gameplay never depends on it.
  }
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatAge(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} MIN`;
  const hours = Math.floor(minutes / 60);
  return `${hours}H ${minutes % 60}M`;
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function canAfford(inventory: Inventory, cost: Inventory) {
  return RESOURCE_KEYS.every((resource) => inventory[resource] >= cost[resource]);
}

function Cost({ cost, compact = false }: { cost: Inventory; compact?: boolean }) {
  const entries = RESOURCE_KEYS.filter((resource) => cost[resource] > 0);
  return (
    <span className={`cost ${compact ? "cost--compact" : ""}`}>
      {entries.length === 0 ? <span>Free</span> : entries.map((resource) => (
        <span className="cost__chip" key={resource} title={RESOURCE_META[resource].label}>
          <span style={{ color: RESOURCE_META[resource].color }}>{RESOURCE_META[resource].icon}</span>
          {cost[resource]}
        </span>
      ))}
    </span>
  );
}

function Vital({ label, value, suffix = "%", tone, detail }: {
  label: string;
  value: number;
  suffix?: string;
  tone: string;
  detail?: string;
}) {
  const normalized = clamp(value);
  return (
    <div className="vital">
      <div className="vital__head">
        <span>{label}</span>
        <strong>{Math.round(value)}{suffix}</strong>
      </div>
      <div className="meter" aria-label={`${label}: ${Math.round(value)}${suffix}`}>
        <i style={{ width: `${normalized}%`, background: tone }} />
      </div>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function Header({ view, setView, connection, player, onSwitch }: {
  view: View;
  setView: (view: View) => void;
  connection: "connecting" | "online" | "offline";
  player: Player | null;
  onSwitch: () => void;
}) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => setView("city")} aria-label="Open city view">
        <span className="brand__mark">A</span>
        <span><b>AFTER</b>HOURS</span>
      </button>
      <nav className="nav" aria-label="Primary navigation">
        <button className={view === "city" ? "is-active" : ""} onClick={() => setView("city")}>City</button>
        <button className={view === "market" ? "is-active" : ""} onClick={() => setView("market")}>Night Market</button>
        <button className={view === "analyst" ? "is-active" : ""} onClick={() => setView("analyst")}>City Intel</button>
      </nav>
      <div className="identity">
        <span className={`connection connection--${connection}`}>
          <i /> {connection === "online" ? "LIVE" : connection.toUpperCase()}
        </span>
        {player && (
          <button className="identity__player" onClick={onSwitch} title="Switch player">
            <span>{player.name.slice(0, 1).toUpperCase()}</span>
            <span className="identity__copy"><b>{player.name}</b><small>{ROLE_META[player.role].label}</small></span>
          </button>
        )}
      </div>
    </header>
  );
}

function InventoryBar({ player }: { player: Player }) {
  return (
    <div className="inventory" aria-label="Your resources">
      <span className="inventory__label">YOUR CACHE</span>
      {RESOURCE_KEYS.map((resource) => (
        <div className="inventory__item" key={resource} title={RESOURCE_META[resource].label}>
          <i style={{ color: RESOURCE_META[resource].color }}>{RESOURCE_META[resource].icon}</i>
          <span>{RESOURCE_META[resource].short}</span>
          <strong>{player.inventory[resource]}</strong>
        </div>
      ))}
      <div className="inventory__item inventory__item--impact">
        <i>✦</i><span>IMPACT</span><strong>{player.contribution}</strong>
      </div>
    </div>
  );
}

function HexBoard({ state, player, selectedTileId, onSelect }: {
  state: GameState;
  player: Player;
  selectedTileId: string;
  onSelect: (tileId: string) => void;
}) {
  const structures = new Map(state.world.structures.map((structure) => [structure.tileId, structure]));
  const occupancy = new Map<string, number>();
  for (const citizen of state.players) occupancy.set(citizen.homeTileId, (occupancy.get(citizen.homeTileId) ?? 0) + 1);

  return (
    <div className="hexboard" role="group" aria-label="Shared 19-hex city board">
      <div className="hexboard__rings" aria-hidden="true"><i /><i /><i /></div>
      {TILES.map((tile) => {
        const structure = structures.get(tile.id);
        const active = state.world.activeTileIds.includes(tile.id);
        const disabled = state.world.blackout.disabledTileIds.includes(tile.id) && state.world.blackout.active;
        const home = player.homeTileId === tile.id;
        const resource = tile.resource ? RESOURCE_META[tile.resource] : null;
        const x = (tile.q + tile.r / 2) * 84;
        const y = tile.r * 72;
        const style = {
          "--x": `${x}px`,
          "--y": `${y}px`,
          "--tile-color": resource?.color ?? "#59f59a",
        } as CSSProperties;
        const classes = [
          "hex",
          tile.id === "core" ? "hex--core" : "",
          active ? "is-pulsing" : "",
          disabled ? "is-disabled" : "",
          home ? "is-home" : "",
          selectedTileId === tile.id ? "is-selected" : "",
        ].filter(Boolean).join(" ");
        return (
          <button
            className={classes}
            style={style}
            key={tile.id}
            onClick={() => onSelect(tile.id)}
            aria-pressed={selectedTileId === tile.id}
            aria-label={tile.id === "core"
              ? "Civic Core"
              : `${resource?.label} district, pulse ${tile.pulseNumber}${home ? ", your home district" : ""}`}
          >
            <span className="hex__inside">
              {tile.id === "core" ? (
                <><b className="hex__coremark">A</b><small>CIVIC CORE</small></>
              ) : (
                <>
                  <small>{resource?.short}</small>
                  <b>{tile.pulseNumber}</b>
                  {structure && <span className="hex__structure" title={BUILDINGS[structure.type].label}>{BUILDINGS[structure.type].icon}</span>}
                  {!!occupancy.get(tile.id) && <span className="hex__people">{occupancy.get(tile.id)}</span>}
                  {home && <span className="hex__home">HOME</span>}
                  {disabled && <span className="hex__offline">OFFLINE</span>}
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TileInspector({ tile, state, player }: { tile: Tile; state: GameState; player: Player }) {
  const structure = state.world.structures.find((candidate) => candidate.tileId === tile.id);
  const residents = state.players.filter((candidate) => candidate.homeTileId === tile.id);
  const disabled = state.world.blackout.active && state.world.blackout.disabledTileIds.includes(tile.id);
  return (
    <div className="inspector">
      <div className="eyebrow">SELECTED DISTRICT</div>
      <div className="inspector__title">
        <div>
          <h3>{tile.district}</h3>
          <p>{tile.id === "core" ? "The heart of the shared civilization" : `${RESOURCE_META[tile.resource!].label} • pulse ${tile.pulseNumber}`}</p>
        </div>
        {tile.resource && <span className="resource-orb" style={{ color: RESOURCE_META[tile.resource].color }}>{RESOURCE_META[tile.resource].icon}</span>}
      </div>
      <div className="inspector__facts">
        <span><small>COORDINATES</small><b>{tile.q}, {tile.r}</b></span>
        <span><small>RESIDENTS</small><b>{residents.length}</b></span>
        <span><small>STATUS</small><b className={disabled ? "danger" : "safe"}>{disabled ? "OFFLINE" : "ONLINE"}</b></span>
      </div>
      {structure ? (
        <div className="structure-card">
          <span className="structure-card__icon">{BUILDINGS[structure.type].icon}</span>
          <div><b>{BUILDINGS[structure.type].label}</b><small>{BUILDINGS[structure.type].effect}</small></div>
          <div className="structure-card__health"><i style={{ width: `${structure.health}%` }} /><small>{Math.round(structure.health)}% integrity</small></div>
        </div>
      ) : tile.id === "core" ? (
        <p className="muted-copy">The Civic Core cannot hold a structure. It reflects the health of every district.</p>
      ) : (
        <p className="muted-copy">No structure yet. Select a blueprint to turn personal resources into shared infrastructure.</p>
      )}
      {player.homeTileId === tile.id && <div className="home-note">Your home district pays you when pulse {tile.pulseNumber} lands.</div>}
    </div>
  );
}

function ActionPanel({ state, player, tile, now, onBuild, onAct }: {
  state: GameState;
  player: Player;
  tile: Tile;
  now: number;
  onBuild: (building: BuildingKey, tileId: string) => Promise<unknown>;
  onAct: (action: CityActionKey) => Promise<unknown>;
}) {
  const [section, setSection] = useState<"respond" | "build">("respond");
  const cooldown = Math.max(0, player.actionReadyAt - now);
  const chargeReady = cooldown <= 0;
  const occupied = state.world.structures.some((structure) => structure.tileId === tile.id);
  const availableActions = (Object.keys(CITY_ACTIONS) as CityActionKey[]).filter((action) =>
    action !== "restore_grid" || state.world.blackout.active,
  );

  return (
    <section className="action-panel panel">
      <div className="panel__head">
        <div><span className="eyebrow">YOUR MOVE</span><h2>Make it count.</h2></div>
        <div className={`charge ${chargeReady ? "is-ready" : ""}`}>
          <i /> {chargeReady ? "ACTION READY" : `RECHARGING ${formatDuration(cooldown)}`}
        </div>
      </div>
      <div className="segmented">
        <button className={section === "respond" ? "is-active" : ""} onClick={() => setSection("respond")}>City response</button>
        <button className={section === "build" ? "is-active" : ""} onClick={() => setSection("build")}>Build on tile</button>
      </div>
      {section === "respond" ? (
        <div className="action-list">
          {availableActions.map((action) => {
            const definition = CITY_ACTIONS[action];
            const affordable = canAfford(player.inventory, definition.cost);
            const disabled = !chargeReady || !affordable || (action === "repair" && !state.world.structures.some((structure) => structure.health < 100));
            return (
              <button className="action-row" key={action} disabled={disabled} onClick={() => onAct(action)}>
                <span className="action-row__icon">{definition.icon}</span>
                <span className="action-row__copy"><b>{definition.label}</b><small>{definition.description}</small></span>
                <Cost cost={definition.cost} compact />
                <span className="action-row__arrow">→</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="blueprints">
          <div className="build-target">
            Building in <b>{tile.district}</b>
            {tile.id === "core" && <span>Choose a resource district first.</span>}
            {occupied && <span>This district already has a structure.</span>}
          </div>
          {BUILDING_KEYS.map((building) => {
            const definition = BUILDINGS[building];
            const affordable = canAfford(player.inventory, definition.cost);
            const disabled = !chargeReady || !affordable || occupied || tile.id === "core" || state.world.blackout.disabledTileIds.includes(tile.id);
            return (
              <button className="blueprint" key={building} disabled={disabled} onClick={() => onBuild(building, tile.id)}>
                <span className="blueprint__icon">{definition.icon}</span>
                <span className="blueprint__copy"><b>{definition.label}</b><small>{definition.description}</small><em>{definition.effect}</em></span>
                <Cost cost={definition.cost} compact />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EventFeed({ events }: { events: GameEvent[] }) {
  const icons: Partial<Record<GameEvent["type"], string>> = {
    player_joined: "+",
    pulse_resolved: "◌",
    resource_minted: "⬡",
    resource_spent: "−",
    world_tick: "⌁",
    action_succeeded: "✓",
    action_rejected: "!",
    building_built: "⌂",
    trade_created: "⇄",
    trade_accepted: "↔",
    blackout_started: "↯",
    blackout_resolved: "ϟ",
    civilization_collapsed: "×",
    civilization_started: "A",
  };
  return (
    <section className="feed panel">
      <div className="panel__head panel__head--compact"><div><span className="eyebrow">LIVE LEDGER</span><h2>The city remembers.</h2></div><span>{events.length} events retained</span></div>
      <div className="feed__list">
        {events
          .map((event, index) => ({ event, index }))
          .sort((left, right) => right.event.at - left.event.at || right.index - left.index)
          .slice(0, 10)
          .map(({ event }) => (
            <article className={`feed__event feed__event--${event.type}`} key={event.id}>
              <span className="feed__icon">{icons[event.type] ?? "•"}</span>
              <p>{event.message}<small>{formatClock(event.at)}</small></p>
            </article>
          ))}
      </div>
    </section>
  );
}

function CityView({ state, player, now, selectedTile, onSelect, onBuild, onAct }: {
  state: GameState;
  player: Player;
  now: number;
  selectedTile: Tile;
  onSelect: (tileId: string) => void;
  onBuild: (building: BuildingKey, tileId: string) => Promise<unknown>;
  onAct: (action: CityActionKey) => Promise<unknown>;
}) {
  const pulseLeft = Math.max(0, state.world.nextPulseAt - now);
  const homeTile = TILES.find((tile) => tile.id === player.homeTileId)!;
  return (
    <>
      <section className="city-grid">
        <div className="board-panel panel">
          <div className="panel__head">
            <div><span className="eyebrow">SHARED CITY • CIV {state.world.civilization}</span><h1>{state.world.blackout.active ? `${state.world.blackout.district} is dark.` : "One city. Every move matters."}</h1></div>
            <div className={`pulse-clock ${state.world.blackout.active ? "is-critical" : ""}`}>
              <span>{state.world.blackout.active ? "BLACKOUT" : "NEXT WORLD PULSE"}</span>
              <b>{state.world.blackout.active ? formatDuration((state.world.blackout.endsAt ?? now) - now) : formatDuration(pulseLeft)}</b>
              <small>{state.world.blackout.active ? "Coordinate a grid restore" : `Last roll: ${state.world.lastPulseRoll ?? "—"}`}</small>
            </div>
          </div>
          <div className="board-wrap">
            <HexBoard state={state} player={player} selectedTileId={selectedTile.id} onSelect={onSelect} />
            <div className="board-legend">
              <span><i className="legend-pulse" /> Active pulse</span>
              <span><i className="legend-home" /> Your district</span>
              <span><i className="legend-structure" /> Structure</span>
            </div>
          </div>
          <div className="home-production">
            <span className="resource-orb resource-orb--small" style={{ color: RESOURCE_META[homeTile.resource!].color }}>{RESOURCE_META[homeTile.resource!].icon}</span>
            <p><small>YOUR PRODUCTION</small><b>{homeTile.district} • {RESOURCE_META[homeTile.resource!].label}</b></p>
            <span>Pulse <strong>{homeTile.pulseNumber}</strong> pays +1</span>
          </div>
        </div>
        <div className="city-sidebar">
          <section className="panel"><TileInspector tile={selectedTile} state={state} player={player} /></section>
          <ActionPanel state={state} player={player} tile={selectedTile} now={now} onBuild={onBuild} onAct={onAct} />
        </div>
      </section>
      <EventFeed events={state.events} />
    </>
  );
}

function TradeCard({ offer, player, now, onAccept, onCancel }: {
  offer: TradeOffer;
  player: Player;
  now: number;
  onAccept: (offerId: string) => Promise<unknown>;
  onCancel: (offerId: string) => Promise<unknown>;
}) {
  const own = offer.makerId === player.id;
  const canPay = player.inventory[offer.want.resource] >= offer.want.amount;
  return (
    <article className={`trade-card ${offer.npc ? "trade-card--npc" : ""}`}>
      <div className="trade-card__maker">
        <span>{offer.npc ? "N" : offer.makerName.slice(0, 1).toUpperCase()}</span>
        <p><b>{offer.makerName}</b><small>{offer.npc ? "AUTONOMOUS DISTRICT" : own ? "YOUR OFFER" : "CITIZEN"}</small></p>
        <time>{formatDuration(offer.expiresAt - now)}</time>
      </div>
      <div className="trade-card__exchange">
        <div style={{ color: RESOURCE_META[offer.give.resource].color }}><span>{RESOURCE_META[offer.give.resource].icon}</span><b>{offer.give.amount}</b><small>{RESOURCE_META[offer.give.resource].label}</small></div>
        <span className="trade-card__arrow">⇄</span>
        <div style={{ color: RESOURCE_META[offer.want.resource].color }}><span>{RESOURCE_META[offer.want.resource].icon}</span><b>{offer.want.amount}</b><small>{RESOURCE_META[offer.want.resource].label}</small></div>
      </div>
      {own ? (
        <button className="button button--quiet" onClick={() => onCancel(offer.id)}>Cancel offer</button>
      ) : (
        <button className="button button--primary" disabled={!canPay} onClick={() => onAccept(offer.id)}>{canPay ? "Accept trade" : `Need ${offer.want.amount} ${RESOURCE_META[offer.want.resource].short}`}</button>
      )}
    </article>
  );
}

function MarketView({ state, player, now, onCreate, onAccept, onCancel }: {
  state: GameState;
  player: Player;
  now: number;
  onCreate: (give: { resource: ResourceKey; amount: number }, want: { resource: ResourceKey; amount: number }) => Promise<unknown>;
  onAccept: (offerId: string) => Promise<unknown>;
  onCancel: (offerId: string) => Promise<unknown>;
}) {
  const [giveResource, setGiveResource] = useState<ResourceKey>("materials");
  const [wantResource, setWantResource] = useState<ResourceKey>("water");
  const [giveAmount, setGiveAmount] = useState(1);
  const [wantAmount, setWantAmount] = useState(1);
  const openOffers = state.trades.filter((offer) => offer.status === "open" && offer.expiresAt > now);
  const ownOpen = openOffers.some((offer) => offer.makerId === player.id);
  const valid = giveResource !== wantResource && player.inventory[giveResource] >= giveAmount && !ownOpen;
  return (
    <section className="market-layout">
      <div className="market-main">
        <div className="section-title"><div><span className="eyebrow">REAL-TIME EXCHANGE</span><h1>The Night Market</h1><p>Trade is free. Civic actions are not. Find the missing piece and save the city.</p></div><span className="market-live"><i /> {openOffers.length} LIVE OFFERS</span></div>
        <div className="trade-grid">
          {openOffers.length ? openOffers.map((offer) => <TradeCard key={offer.id} offer={offer} player={player} now={now} onAccept={onAccept} onCancel={onCancel} />) : (
            <div className="empty-state"><span>⇄</span><h3>The market is quiet.</h3><p>Post an offer. Autonomous districts also publish new trades as pulses pass.</p></div>
          )}
        </div>
      </div>
      <aside className="create-trade panel">
        <span className="eyebrow">POST AN OFFER</span><h2>Turn surplus into survival.</h2>
        {ownOpen && <div className="notice">You already have one active offer. Cancel or wait for it to expire.</div>}
        <label>You give</label>
        <div className="trade-input">
          <select value={giveResource} onChange={(event) => setGiveResource(event.target.value as ResourceKey)}>
            {RESOURCE_KEYS.map((resource) => <option value={resource} key={resource}>{RESOURCE_META[resource].label}</option>)}
          </select>
          <input aria-label="Amount you give" type="number" min={1} max={3} value={giveAmount} onChange={(event) => setGiveAmount(clamp(Number(event.target.value), 1, 3))} />
        </div>
        <small className="availability">Available: {player.inventory[giveResource]} {RESOURCE_META[giveResource].short}</small>
        <div className="exchange-line"><i /> FOR <i /></div>
        <label>You request</label>
        <div className="trade-input">
          <select value={wantResource} onChange={(event) => setWantResource(event.target.value as ResourceKey)}>
            {RESOURCE_KEYS.map((resource) => <option value={resource} key={resource}>{RESOURCE_META[resource].label}</option>)}
          </select>
          <input aria-label="Amount you request" type="number" min={1} max={3} value={wantAmount} onChange={(event) => setWantAmount(clamp(Number(event.target.value), 1, 3))} />
        </div>
        {giveResource === wantResource && <small className="form-error">Choose two different resources.</small>}
        <button className="button button--primary button--large" disabled={!valid} onClick={() => onCreate({ resource: giveResource, amount: giveAmount }, { resource: wantResource, amount: wantAmount })}>Publish for 2 minutes</button>
        <p className="fine-print">Your inventory is verified atomically when someone accepts. Keep the offered resources available.</p>
      </aside>
    </section>
  );
}

function downloadFile(name: string, content: string, type: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
}

function AnalystView({ state }: { state: GameState }) {
  const analytics = state.analytics;
  const currentSamples = analytics.samples.filter(
    (sample) => sample.civilization === state.world.civilization,
  );
  const snapshot = buildKpiSnapshot(state);
  const activation = snapshot.activation.rate;
  const actionSuccess = snapshot.actionSuccess.rate;
  const tradeConversion = snapshot.tradeConversion.rate;
  const healthScore = snapshot.cityHealth.score;
  const minted = snapshot.economy.totalMinted;
  const spent = snapshot.economy.totalSpent;
  const warnings = getBalanceWarnings(state);

  const points = currentSamples.slice(-36).map((sample, index, samples) => {
    const score = cityHealthScore(sample);
    const x = samples.length <= 1 ? 0 : index / (samples.length - 1) * 100;
    const y = 100 - score;
    return `${x},${y}`;
  }).join(" ");

  const exportCsv = () => downloadFile(
    `afterhours-civ-${state.world.civilization}-metrics.csv`,
    buildAnalyticsCsv(state),
    "text/csv",
  );

  return (
    <section className="intel">
      <div className="section-title"><div><span className="eyebrow">DATA / BUSINESS ANALYST</span><h1>City Intelligence</h1><p>Server-authoritative evidence for balance, reliability, and player comprehension.</p></div><div className="export-actions"><button className="button button--quiet" onClick={exportCsv}>Export KPI CSV</button><button className="button button--quiet" onClick={() => downloadFile(`afterhours-civ-${state.world.civilization}-analytics.json`, buildAnalyticsJson(state), "application/json")}>Export analytics JSON</button></div></div>
      <div className="kpi-grid">
        <Kpi label="CITY HEALTH" value={`${healthScore}`} suffix="/100" detail="Food, power, stability, integrity" tone={healthScore >= 60 ? "good" : "warn"} />
        <Kpi label="ACTIVATION" value={`${Math.round(activation * 100)}%`} detail="Players completing a first action" tone={activation >= 0.7 ? "good" : "warn"} />
        <Kpi label="ACTION SUCCESS" value={`${Math.round(actionSuccess * 100)}%`} detail={`${analytics.actionSuccesses} of ${analytics.actionAttempts} attempts`} tone={actionSuccess >= 0.7 ? "good" : "warn"} />
        <Kpi label="TRADE CONVERSION" value={`${Math.round(tradeConversion * 100)}%`} detail={`${analytics.tradesAccepted} of ${analytics.tradeOffersCreated} lifetime offers`} tone={tradeConversion >= 0.25 ? "good" : "neutral"} />
      </div>
      <div className="intel-grid">
        <section className="panel chart-panel">
          <div className="panel__head panel__head--compact"><div><span className="eyebrow">HEALTH TREND • CURRENT CIV</span><h2>Can this city survive?</h2></div><strong>{currentSamples.length} samples</strong></div>
          <div className="line-chart">
            {points ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="City health trend"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#56f29a" stopOpacity=".32"/><stop offset="1" stopColor="#56f29a" stopOpacity="0"/></linearGradient></defs><polyline points={`0,100 ${points} 100,100`} fill="url(#chartFill)" stroke="none"/><polyline points={points} fill="none" stroke="#56f29a" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : <div className="empty-chart">Waiting for world ticks…</div>}
            <span className="chart-label chart-label--top">100</span><span className="chart-label chart-label--bottom">0</span>
          </div>
        </section>
        <section className="panel economy-panel">
          <div className="panel__head panel__head--compact"><div><span className="eyebrow">SOURCE / SINK</span><h2>Economy flow</h2></div><strong className={minted > spent * 2 ? "warning-text" : "safe"}>{minted - spent >= 0 ? "+" : ""}{minted - spent} NET</strong></div>
          <div className="economy-table">
            <div className="economy-table__head"><span>RESOURCE</span><span>MINTED</span><span>SPENT</span><span>NET</span></div>
            {snapshot.economy.resources.map((entry) => {
              const resource = entry.resource;
              return <div className="economy-table__row" key={resource}><span><i style={{ color: RESOURCE_META[resource].color }}>{RESOURCE_META[resource].icon}</i>{RESOURCE_META[resource].label}</span><b>{entry.minted}</b><b>{entry.spent}</b><strong className={entry.net < 0 ? "danger" : "safe"}>{entry.net > 0 ? "+" : ""}{entry.net}</strong></div>;
            })}
          </div>
        </section>
      </div>
      <section className="panel warnings">
        <div className="panel__head panel__head--compact"><div><span className="eyebrow">AUTOMATED REVIEW</span><h2>Balance signals</h2></div><span>CONFIG {state.configVersion}</span></div>
        {warnings.length ? <div className="warning-list">{warnings.map((warning) => <div key={warning.id}><span>{warning.severity === "critical" ? "!" : "i"}</span><p><b>{warning.message}</b><small>{warning.evidence} {warning.recommendation}</small></p></div>)}</div> : <div className="all-clear"><span>✓</span><p><b>No urgent balance warnings.</b><small>Sample-size gates are active; keep collecting play sessions before locking the next configuration.</small></p></div>}
      </section>
    </section>
  );
}

function Kpi({ label, value, suffix, detail, tone }: { label: string; value: string; suffix?: string; detail: string; tone: "good" | "warn" | "neutral" }) {
  return <article className={`kpi kpi--${tone}`}><span>{label}</span><strong>{value}<small>{suffix}</small></strong><p>{detail}</p><i /></article>;
}

function JoinScreen({ state, connection, onJoin }: {
  state: GameState;
  connection: "connecting" | "online" | "offline";
  onJoin: (name: string, role: RoleKey) => Promise<{ ok: boolean; message: string }>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<RoleKey>("builder");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (name.trim().length < 2) { setError("Use at least two characters for your callsign."); return; }
    setBusy(true); setError("");
    const result = await onJoin(name.trim(), role);
    setBusy(false);
    if (!result.ok) setError(result.message);
  };
  return (
    <div className="join-screen">
      <div className="join-screen__ambient" aria-hidden="true"><i /><i /><i /></div>
      <main className="join-card">
        <div className="join-brand"><span>A</span><p><b>AFTER</b>HOURS<small>THE CITY NEVER SLEEPS</small></p></div>
        <div className="join-intro"><span className="eyebrow">CIVILIZATION {state.world.civilization} • {state.players.length} CITIZENS</span><h1>Your shift starts now.</h1><p>Choose a civic role, claim a production district, and spend your one move where everyone will feel it.</p></div>
        <label className="field-label" htmlFor="callsign">CALLSIGN</label>
        <input id="callsign" className="callsign" value={name} maxLength={24} autoFocus placeholder="How will the city remember you?" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
        <span className="field-label">CHOOSE YOUR ROLE</span>
        <div className="roles">
          {ROLE_KEYS.map((candidate) => {
            const definition = ROLE_META[candidate];
            return <button className={role === candidate ? "is-selected" : ""} key={candidate} onClick={() => setRole(candidate)}><span style={{ color: RESOURCE_META[definition.resource].color }}>{RESOURCE_META[definition.resource].icon}</span><b>{definition.label}</b><small>{definition.blurb}</small></button>;
          })}
        </div>
        {error && <div className="form-error form-error--box">{error}</div>}
        <button className="button button--primary button--join" disabled={busy || connection !== "online"} onClick={submit}>{busy ? "Joining the world…" : connection !== "online" ? "Connecting to city…" : "Enter AFTERHOURS →"}</button>
        <div className="join-proof"><span><i /> Persistent world</span><span><i /> Live multiplayer</span><span><i /> Server-authoritative</span></div>
      </main>
    </div>
  );
}

function AwayModal({ summary, onClose }: { summary: AwaySummary; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="away-title">
      <section className="away-modal">
        <span className="eyebrow">WHILE YOU WERE GONE</span><h1 id="away-title">The city lived for {formatDuration(summary.elapsedMs)}.</h1>
        <p>Your shift ended. The shared world did not.</p>
        <div className="away-stats">
          <div><span>♟</span><p><small>POPULATION</small><b>{summary.populationBefore} → {summary.populationAfter}</b></p></div>
          <div><span>◌</span><p><small>WORLD PULSES</small><b>{summary.pulses}</b></p></div>
          <div><span>⇄</span><p><small>TRADES</small><b>{summary.trades}</b></p></div>
          <div><span>↯</span><p><small>BLACKOUTS</small><b>{summary.blackouts}</b></p></div>
          <div><span>⌂</span><p><small>NEW STRUCTURES</small><b>{summary.structures}</b></p></div>
          <div><span>⌁</span><p><small>WORLD TICKS</small><b>{summary.ticks}</b></p></div>
        </div>
        <button className="button button--primary button--large" autoFocus onClick={onClose}>Return to your district</button>
      </section>
    </div>
  );
}

function App() {
  const game = useGame();
  const [view, setView] = useState<View>("city");
  const [now, setNow] = useState(Date.now());
  const [selectedTileId, setSelectedTileId] = useState("core");
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (game.currentPlayer && selectedTileId === "core") setSelectedTileId(game.currentPlayer.homeTileId);
  }, [game.currentPlayer, selectedTileId]);

  useEffect(() => {
    if (!game.lastResult) return;
    if (sound) playTone(game.lastResult.ok ? "success" : "error");
    const timer = window.setTimeout(game.clearLastResult, 3_200);
    return () => window.clearTimeout(timer);
  }, [game.lastResult, game.clearLastResult, sound]);

  const selectedTile = useMemo(() => TILES.find((tile) => tile.id === selectedTileId) ?? TILES[9], [selectedTileId]);
  const serverNow = game.serverNow + (now - Date.now());

  if (!game.state) {
    return <div className="loading-screen"><div className="loading-mark">A</div><p>WAKING THE CITY</p><i /></div>;
  }

  if (!game.currentPlayer) {
    return <JoinScreen state={game.state} connection={game.connection} onJoin={game.join} />;
  }

  const run = async (operation: Promise<{ ok: boolean; message: string }>) => operation;
  const world = game.state.world;

  return (
    <div className={world.blackout.active ? "app app--blackout" : "app"}>
      <Header view={view} setView={setView} connection={game.connection} player={game.currentPlayer} onSwitch={game.switchPlayer} />
      {game.connection !== "online" && <div className="offline-banner">City link interrupted. Reconnect before committing your next action.</div>}
      <main className="shell">
        <section className="status-ribbon">
          <div className="status-ribbon__intro"><span className="eyebrow">CIV {world.civilization} • AGE {formatAge(serverNow - world.createdAt)}</span><h2>{world.status === "collapsed" ? "Civilization collapsed" : world.blackout.active ? "A district needs you now" : "The night shift is holding"}</h2></div>
          <Vital label="FOOD" value={world.food} tone="#76ef9d" detail={`${world.population} citizens`} />
          <Vital label="POWER" value={world.power} tone="#ffe66d" detail={`${world.structures.filter((item) => item.type === "reactor").length} reactors`} />
          <Vital label="STABILITY" value={world.stability} tone="#64d8ff" detail={`Threat ${Math.round(world.threat)}%`} />
          <Vital label="INTEGRITY" value={world.buildingHealth} tone="#c7a3ff" detail={`${world.structures.length} structures`} />
          <div className="population"><small>POPULATION</small><b>{world.population}<span> / {world.populationCap}</span></b></div>
        </section>
        <InventoryBar player={game.currentPlayer} />
        {view === "city" && <CityView state={game.state} player={game.currentPlayer} now={serverNow} selectedTile={selectedTile} onSelect={setSelectedTileId} onBuild={(building, tileId) => run(game.build(building, tileId))} onAct={(action) => run(game.act(action))} />}
        {view === "market" && <MarketView state={game.state} player={game.currentPlayer} now={serverNow} onCreate={(give, want) => run(game.createTrade(give, want))} onAccept={(offerId) => run(game.acceptTrade(offerId))} onCancel={(offerId) => run(game.cancelTrade(offerId))} />}
        {view === "analyst" && <AnalystView state={game.state} />}
      </main>
      <footer className="footer"><span>AFTERHOURS • CONFIG {game.state.configVersion}</span><span>WORLD REVISION {world.revision}</span><button onClick={() => setSound((enabled) => !enabled)}>{sound ? "Sound on" : "Sound off"}</button><button onClick={game.switchPlayer}>Change identity</button><button className="footer__danger" onClick={() => window.confirm("Begin a new civilization? Current structures and inventories reset; the lifetime ledger and analytics remain.") && game.reset()}>New civilization</button></footer>
      {game.lastResult && <div className={`toast ${game.lastResult.ok ? "toast--success" : "toast--error"}`} role="status"><span>{game.lastResult.ok ? "✓" : "!"}</span>{game.lastResult.message}</div>}
      {game.awaySummary && <AwayModal summary={game.awaySummary} onClose={game.clearAwaySummary} />}
      {world.status === "collapsed" && !game.awaySummary && <div className="modal-backdrop"><section className="collapse-modal"><span>×</span><small>CIVILIZATION {world.civilization}</small><h1>The city went dark.</h1><p>The archive keeps what happened. Begin again with what the data taught you.</p><button className="button button--primary button--large" onClick={() => game.reset()}>Start civilization {world.civilization + 1}</button></section></div>}
    </div>
  );
}

export default App;
