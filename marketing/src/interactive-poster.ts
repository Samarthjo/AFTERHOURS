import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-900.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-700.css';
import * as d3 from 'd3';
import QRCode from 'qrcode';

type Shift = 'dusk' | 'deep' | 'dawn';
type Grid = 'strained' | 'stable' | 'surplus';
type Pressure = 'watch' | 'critical' | 'cascade';
type CivicRole = 'architect' | 'cultivator' | 'engineer' | 'operator' | 'medic';
type StudioMode = 'qr' | 'sculpture';
type PosterEvent = 'poster_started' | 'poster_midpoint' | 'poster_completed' | 'cta_clicked';

interface CityState {
  shift: Shift;
  grid: Grid;
  pressure: Pressure;
}

interface Point {
  x: number;
  y: number;
}

interface ShiftProfile {
  time: string;
  name: string;
  message: string;
  skyTop: string;
  skyBottom: string;
  horizon: string;
  stars: number;
}

interface GridProfile {
  value: number;
  name: string;
  message: string;
  litChance: number;
  window: string;
  vein: string;
  veinAlpha: number;
}

interface PressureProfile {
  value: number;
  name: string;
  message: string;
  accent: string;
  beacons: number;
  pulseSpeed: number;
  rain: number;
}

interface RoleProfile {
  label: string;
  kicker: string;
  copy: string;
  object: string;
  palette: {
    primary: string;
    dark: string;
    soft: string;
  };
}

interface Voxel {
  x: number;
  y: number;
  z: number;
  material: VoxelMaterial;
}

type VoxelMaterial =
  | 'primary'
  | 'dark'
  | 'soft'
  | 'skin'
  | 'helmet'
  | 'paper'
  | 'paper-line'
  | 'leaf'
  | 'wood'
  | 'metal'
  | 'screen'
  | 'white'
  | 'cross'
  | 'soil';

interface MorphTarget {
  path: string;
  fill: string;
}

interface MorphModule {
  id: string;
  qrPath: string;
  planePath: string;
  wave: number;
  isFinder: boolean;
  targets: Record<CivicRole, MorphTarget>;
}

const CAMPAIGN = 'poster-launch-v1';
const QR_DESTINATION_URL = 'https://afterhours-night-shift.vercel.app/p/1';
const POSTER_SHARE_URL = 'https://afterhours-night-shift.vercel.app/poster';
const QR_FIELD_ORIGIN = 60;
const QR_FIELD_SIZE = 600;
const QR_QUIET_ZONE = 4;
const QR_CENTER = 360;
const PLANE_CENTER_Y = 410;
const PLANE_SCALE = 0.78;
const PLANE_PITCH = 0.56;
const PLANE_COSINE = Math.SQRT1_2 * PLANE_SCALE;
const PLANE_SINE = Math.SQRT1_2 * PLANE_SCALE * PLANE_PITCH;
const PLANE_MATRIX = `matrix(${precise(PLANE_COSINE)} ${precise(PLANE_SINE)} ${precise(-PLANE_COSINE)} ${precise(PLANE_SINE)} ${QR_CENTER} ${precise(PLANE_CENTER_Y - PLANE_SINE * QR_CENTER * 2)})`;

const civicRoles: readonly CivicRole[] = ['architect', 'cultivator', 'engineer', 'operator', 'medic'];

const roleProfiles: Record<CivicRole, RoleProfile> = {
  architect: {
    label: 'Architect',
    kicker: 'MATERIALS / INFRASTRUCTURE',
    copy: 'Build capacity before the city outgrows itself.',
    object: 'an architect wearing a hard hat and holding a blueprint',
    palette: { primary: '#1d6b58', dark: '#103d34', soft: '#8fd7be' },
  },
  cultivator: {
    label: 'Cultivator',
    kicker: 'WATER / FOOD',
    copy: 'Turn scarce water into a pantry the city can trust.',
    object: 'a cultivator carrying a sprouting plant and a field hoe',
    palette: { primary: '#5f7c2e', dark: '#30451d', soft: '#c8df76' },
  },
  engineer: {
    label: 'Engineer',
    kicker: 'COMPONENTS / MAINTENANCE',
    copy: 'Hear the fault early, then keep the whole machine breathing.',
    object: 'an engineer wearing a hard hat and raising a wrench',
    palette: { primary: '#34758a', dark: '#183e49', soft: '#94d9e5' },
  },
  operator: {
    label: 'Operator',
    kicker: 'FUEL / POWER',
    copy: 'Route the last clean watts to the ward that needs them most.',
    object: 'an operator wearing a headset at a live console',
    palette: { primary: '#bb7027', dark: '#624015', soft: '#f2bb5d' },
  },
  medic: {
    label: 'Medic',
    kicker: 'MEDICINE / STABILITY',
    copy: 'Treat the people and the panic before either one spreads.',
    object: 'a medic carrying a cross-marked field bag',
    palette: { primary: '#ad5064', dark: '#5d2936', soft: '#ef9fb0' },
  },
};

const shifts: Record<Shift, ShiftProfile> = {
  dusk: {
    time: '21:10',
    name: 'Dusk',
    message: 'Dusk settles across the districts.',
    skyTop: '#0b2827',
    skyBottom: '#13372d',
    horizon: '#4acb91',
    stars: 0.28,
  },
  deep: {
    time: '01:30',
    name: 'Deep',
    message: 'Deep shift; the city should be sleeping.',
    skyTop: '#020807',
    skyBottom: '#092019',
    horizon: '#2ea876',
    stars: 0.92,
  },
  dawn: {
    time: '04:45',
    name: 'Dawn',
    message: 'Dawn is close, not guaranteed.',
    skyTop: '#171b2a',
    skyBottom: '#553a3c',
    horizon: '#ff9b68',
    stars: 0.4,
  },
};

const grids: Record<Grid, GridProfile> = {
  strained: {
    value: 31,
    name: 'strained',
    message: 'Power is being rationed.',
    litChance: 0.2,
    window: '#ff8e70',
    vein: '#ff746b',
    veinAlpha: 0.26,
  },
  stable: {
    value: 68,
    name: 'stable',
    message: 'The grid is holding—for now.',
    litChance: 0.49,
    window: '#68f3a2',
    vein: '#62f59b',
    veinAlpha: 0.5,
  },
  surplus: {
    value: 94,
    name: 'in surplus',
    message: 'Spare power is reaching every ward.',
    litChance: 0.78,
    window: '#dcff73',
    vein: '#d8ff63',
    veinAlpha: 0.82,
  },
};

const pressures: Record<Pressure, PressureProfile> = {
  watch: {
    value: 24,
    name: 'Watch',
    message: 'Dispatch is watching a quiet board.',
    accent: '#62f59b',
    beacons: 0.08,
    pulseSpeed: 0.00032,
    rain: 0,
  },
  critical: {
    value: 71,
    name: 'Critical',
    message: 'Several districts need an answer.',
    accent: '#ffc768',
    beacons: 0.24,
    pulseSpeed: 0.00052,
    rain: 16,
  },
  cascade: {
    value: 96,
    name: 'Cascade',
    message: 'Every civic role is being paged.',
    accent: '#ff746b',
    beacons: 0.52,
    pulseSpeed: 0.00082,
    rain: 46,
  },
};

const posterShell = required<HTMLElement>('#interactive-poster');
const cityTrigger = required<HTMLButtonElement>('#city-trigger');
const cityCanvas = required<HTMLCanvasElement>('#city-canvas');
const coreTarget = required<HTMLElement>('.core-target');
const qrDialog = required<HTMLDialogElement>('#qr-dialog');
const morphTrigger = required<HTMLButtonElement>('#morph-trigger');
const morphSvg = required<SVGSVGElement>('#qr-morph');
const moduleField = required<SVGGElement>('#qr-module-field');
const morphPlate = required<SVGRectElement>('#qr-morph-plate');
const morphTitle = required<SVGTitleElement>('#morph-title');
const morphDescription = required<SVGDescElement>('#morph-description');
const morphTapLabel = required<HTMLElement>('#morph-tap-label');
const studioMorphStatus = required<HTMLElement>('#studio-morph-status');
const studioRoleKicker = required<HTMLElement>('#studio-role-kicker');
const studioRoleTitle = required<HTMLElement>('#qr-title');
const studioRoleDescription = required<HTMLElement>('#qr-description');
const studioShareButton = required<HTMLButtonElement>('#studio-share');
const studioRoleInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="studio-role"]'));
const shareButton = required<HTMLButtonElement>('#share-poster');
const waitlistLink = required<HTMLAnchorElement>('#poster-waitlist');
const waitlistRoleLabel = required<HTMLElement>('#poster-waitlist-role');
const shareStatus = required<HTMLElement>('#share-status');
const stateNarrative = required<HTMLElement>('#state-narrative');
const shiftReadout = required<HTMLElement>('#shift-readout');
const gridReadout = required<HTMLElement>('#grid-readout');
const pressureReadout = required<HTMLElement>('#pressure-readout');
const context = requireCanvasContext(cityCanvas);

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
let state = readInitialState();
let selectedStudioRole = readInitialRole();
let studioMode: StudioMode = 'qr';
let morphRevision = 0;
let renderedStudioMode: StudioMode = 'qr';
let renderedStudioRole: CivicRole = selectedStudioRole;
let morphLocked = false;
let viewWidth = 0;
let viewHeight = 0;
let pixelRatio = 1;
let frameRequest = 0;
let previousFrame = 0;
let lastCoreX = Number.NaN;
let lastCoreY = Number.NaN;
let pointerStart: Point | null = null;
let pointerDistance = 0;
let suppressNextClick = false;
let statusTimer = 0;
let revealInProgress = false;

const motion = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
};

const emittedEvents = new Set<PosterEvent>();
const sessionId = getSessionId();
const morphModules = createMorphModules();
const moduleSelection = d3
  .select(moduleField)
  .selectAll<SVGPathElement, MorphModule>('path')
  .data(morphModules, (datum) => datum.id)
  .join('path')
  .attr('class', 'morph-module')
  .attr('d', (datum) => datum.qrPath)
  .attr('fill', roleProfiles[selectedStudioRole].palette.dark)
  .attr('stroke', 'none')
  .attr('stroke-width', 0)
  .attr('stroke-linejoin', 'round');
const plateSelection = d3.select(morphPlate);

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required poster element is missing: ${selector}`);
  return element;
}

function requireCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const value = canvas.getContext('2d');
  if (!value) throw new Error('Canvas 2D is unavailable.');
  return value;
}

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readInitialState(): CityState {
  const query = new URLSearchParams(window.location.search);
  return {
    shift: oneOf(query.get('shift'), ['dusk', 'deep', 'dawn'] as const, 'deep'),
    grid: oneOf(query.get('grid'), ['strained', 'stable', 'surplus'] as const, 'stable'),
    pressure: oneOf(query.get('pressure'), ['watch', 'critical', 'cascade'] as const, 'critical'),
  };
}

function readInitialRole(): CivicRole {
  const query = new URLSearchParams(window.location.search);
  return oneOf(query.get('role'), civicRoles, 'architect');
}

function getSessionId(): string {
  const key = 'afterhours.session.v1';
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const value = crypto.randomUUID();
    window.sessionStorage.setItem(key, value);
    return value;
  } catch {
    return crypto.randomUUID();
  }
}

function viewportBucket(): 'compact' | 'regular' | 'wide' {
  if (window.innerWidth < 640) return 'compact';
  if (window.innerWidth < 1180) return 'regular';
  return 'wide';
}

function trackPoster(
  eventName: PosterEvent,
  dimensions: { role: CivicRole; placement: 'hero'; destination: 'waitlist' } | null = null,
): void {
  if (emittedEvents.has(eventName)) return;
  emittedEvents.add(eventName);
  const payload = {
    eventId: crypto.randomUUID(),
    sessionId,
    campaign: CAMPAIGN,
    eventName,
    path: '/poster',
    viewportBucket: viewportBucket(),
    ...(dimensions ?? {}),
  };

  void fetch('/api/track', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

function pseudo(x: number, y: number, salt = 0): number {
  const raw = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return raw - Math.floor(raw);
}

function precise(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function structuredPath(vertices: [Point, Point, Point, Point, Point, Point], center: Point): string {
  const [a, b, c, d, e, f] = vertices;
  return [
    `M${precise(a.x)},${precise(a.y)}`,
    `L${precise(b.x)},${precise(b.y)}`,
    `L${precise(c.x)},${precise(c.y)}`,
    `L${precise(d.x)},${precise(d.y)}`,
    `L${precise(e.x)},${precise(e.y)}`,
    `L${precise(f.x)},${precise(f.y)}Z`,
    `M${precise(f.x)},${precise(f.y)}L${precise(center.x)},${precise(center.y)}`,
    `M${precise(b.x)},${precise(b.y)}L${precise(center.x)},${precise(center.y)}`,
    `M${precise(d.x)},${precise(d.y)}L${precise(center.x)},${precise(center.y)}`,
  ].join('');
}

function qrSquarePath(x: number, y: number, size: number): string {
  const center = { x: x + size / 2, y: y + size / 2 };
  return structuredPath(
    [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x: x + size, y: y + size },
      { x, y: y + size },
      { x, y },
    ],
    center,
  );
}

function planePoint(point: Point): Point {
  const deltaX = point.x - QR_CENTER;
  const deltaY = point.y - QR_CENTER;
  return {
    x: QR_CENTER + (deltaX - deltaY) * PLANE_COSINE,
    y: PLANE_CENTER_Y + (deltaX + deltaY) * PLANE_SINE,
  };
}

function planeSquarePath(x: number, y: number, size: number): string {
  const topLeft = planePoint({ x, y });
  const topRight = planePoint({ x: x + size, y });
  const bottomRight = planePoint({ x: x + size, y: y + size });
  const bottomLeft = planePoint({ x, y: y + size });
  return structuredPath(
    [topLeft, topRight, bottomRight, bottomRight, bottomLeft, topLeft],
    planePoint({ x: x + size / 2, y: y + size / 2 }),
  );
}

function isFinderModule(row: number, column: number, matrixSize: number): boolean {
  const nearStartRow = row < 7;
  const nearStartColumn = column < 7;
  const nearEndRow = row >= matrixSize - 7;
  const nearEndColumn = column >= matrixSize - 7;
  return (
    (nearStartRow && nearStartColumn) ||
    (nearStartRow && nearEndColumn) ||
    (nearEndRow && nearStartColumn)
  );
}

function voxelPath(center: Point, width: number, height: number): string {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return structuredPath(
    [
      { x: center.x, y: center.y - height },
      { x: center.x + halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y + halfHeight },
      { x: center.x, y: center.y + height },
      { x: center.x - halfWidth, y: center.y + halfHeight },
      { x: center.x - halfWidth, y: center.y - halfHeight },
    ],
    center,
  );
}

function addVoxel(
  voxels: Map<string, Voxel>,
  x: number,
  y: number,
  z: number,
  material: VoxelMaterial = 'primary',
): void {
  const rounded = { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
  voxels.set(`${rounded.x}:${rounded.y}:${rounded.z}`, { ...rounded, material });
}

function addBox(
  voxels: Map<string, Voxel>,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
  zStart: number,
  zEnd: number,
  material: VoxelMaterial = 'primary',
): void {
  for (let x = xStart; x <= xEnd; x += 1) {
    for (let y = yStart; y <= yEnd; y += 1) {
      for (let z = zStart; z <= zEnd; z += 1) addVoxel(voxels, x, y, z, material);
    }
  }
}

function pointInPolygon(point: Point, vertices: readonly Point[]): boolean {
  let inside = false;
  for (let current = 0, previous = vertices.length - 1; current < vertices.length; previous = current, current += 1) {
    const currentVertex = vertices[current];
    const previousVertex = vertices[previous];
    const crosses = currentVertex.y > point.y !== previousVertex.y > point.y;
    const crossingX =
      ((previousVertex.x - currentVertex.x) * (point.y - currentVertex.y)) /
        (previousVertex.y - currentVertex.y || Number.EPSILON) +
      currentVertex.x;
    if (crosses && point.x < crossingX) inside = !inside;
  }
  return inside;
}

function addPolygonExtrusion(
  voxels: Map<string, Voxel>,
  vertices: readonly Point[],
  yStart: number,
  yEnd: number,
  material: VoxelMaterial,
): void {
  const xExtent = d3.extent(vertices, (vertex) => vertex.x) as [number, number];
  const zExtent = d3.extent(vertices, (vertex) => vertex.y) as [number, number];
  for (let x = Math.floor(xExtent[0]); x <= Math.ceil(xExtent[1]); x += 1) {
    for (let z = Math.floor(zExtent[0]); z <= Math.ceil(zExtent[1]); z += 1) {
      if (!pointInPolygon({ x, y: z }, vertices)) continue;
      for (let y = yStart; y <= yEnd; y += 1) addVoxel(voxels, x, y, z, material);
    }
  }
}

function addEllipse(
  voxels: Map<string, Voxel>,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  yStart: number,
  yEnd: number,
  material: VoxelMaterial,
): void {
  for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x += 1) {
    for (let z = Math.floor(centerZ - radiusZ); z <= Math.ceil(centerZ + radiusZ); z += 1) {
      const normalizedX = (x - centerX) / radiusX;
      const normalizedZ = (z - centerZ) / radiusZ;
      if (normalizedX * normalizedX + normalizedZ * normalizedZ > 1) continue;
      for (let y = yStart; y <= yEnd; y += 1) addVoxel(voxels, x, y, z, material);
    }
  }
}

function addEllipseRing(
  voxels: Map<string, Voxel>,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  thickness: number,
  y: number,
  material: VoxelMaterial,
): void {
  const innerRadiusX = Math.max(0.1, radiusX - thickness);
  const innerRadiusZ = Math.max(0.1, radiusZ - thickness);
  for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x += 1) {
    for (let z = Math.floor(centerZ - radiusZ); z <= Math.ceil(centerZ + radiusZ); z += 1) {
      const outerX = (x - centerX) / radiusX;
      const outerZ = (z - centerZ) / radiusZ;
      const innerX = (x - centerX) / innerRadiusX;
      const innerZ = (z - centerZ) / innerRadiusZ;
      const insideOuter = outerX * outerX + outerZ * outerZ <= 1;
      const outsideInner = innerX * innerX + innerZ * innerZ >= 1;
      if (insideOuter && outsideInner) addVoxel(voxels, x, y, z, material);
    }
  }
}

function addLine(
  voxels: Map<string, Voxel>,
  xStart: number,
  zStart: number,
  xEnd: number,
  zEnd: number,
  thickness: number,
  y: number,
  material: VoxelMaterial,
): void {
  const steps = Math.max(Math.abs(xEnd - xStart), Math.abs(zEnd - zStart), 1) * 2;
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    const centerX = Math.round(xStart + (xEnd - xStart) * amount);
    const centerZ = Math.round(zStart + (zEnd - zStart) * amount);
    for (let offsetX = -thickness; offsetX <= thickness; offsetX += 1) {
      for (let offsetZ = -thickness; offsetZ <= thickness; offsetZ += 1) {
        if (Math.hypot(offsetX, offsetZ) > thickness + 0.2) continue;
        addVoxel(voxels, centerX + offsetX, y, centerZ + offsetZ, material);
      }
    }
  }
}

function addStandingFigure(voxels: Map<string, Voxel>): void {
  addBox(voxels, -7, -3, 0, 0, 0, 2, 'dark');
  addBox(voxels, 3, 7, 0, 0, 0, 2, 'dark');
  addBox(voxels, -6, -3, 0, 0, 3, 11);
  addBox(voxels, 3, 6, 0, 0, 3, 11);
  addPolygonExtrusion(
    voxels,
    [
      { x: -7, y: 11 },
      { x: 7, y: 11 },
      { x: 8, y: 22 },
      { x: -8, y: 22 },
    ],
    0,
    0,
    'primary',
  );
  addBox(voxels, -2, 2, 0, 0, 23, 24, 'skin');
  addEllipse(voxels, 0, 29, 5, 5, 0, 0, 'skin');
}

function architectVoxels(): Voxel[] {
  const voxels = new Map<string, Voxel>();
  addStandingFigure(voxels);
  addLine(voxels, -7, 21, -12, 15, 1, 0, 'primary');
  addLine(voxels, 7, 21, 12, 15, 1, 0, 'primary');
  addEllipse(voxels, -12, 14, 2, 2, 0, 0, 'skin');
  addEllipse(voxels, 12, 14, 2, 2, 0, 0, 'skin');

  // A broad brim is readable before the face and makes the hard hat unmistakable.
  addEllipse(voxels, 0, 34, 7, 3, 0, 0, 'helmet');
  addBox(voxels, -8, 8, 1, 1, 32, 33, 'helmet');
  addBox(voxels, -5, -4, 1, 1, 15, 21, 'soft');
  addBox(voxels, 4, 5, 1, 1, 15, 21, 'soft');

  // The blueprint sits on the front layer, with a border and a tiny floor-plan grid.
  addBox(voxels, -12, 12, 2, 2, 10, 16, 'paper');
  addBox(voxels, -12, 12, 3, 3, 10, 10, 'paper-line');
  addBox(voxels, -12, 12, 3, 3, 16, 16, 'paper-line');
  addBox(voxels, -12, -12, 3, 3, 11, 15, 'paper-line');
  addBox(voxels, 12, 12, 3, 3, 11, 15, 'paper-line');
  addBox(voxels, -4, -4, 3, 3, 11, 15, 'paper-line');
  addBox(voxels, 4, 4, 3, 3, 11, 15, 'paper-line');
  addBox(voxels, -11, 11, 3, 3, 13, 13, 'paper-line');
  return [...voxels.values()];
}

function cultivatorVoxels(): Voxel[] {
  const voxels = new Map<string, Voxel>();
  addStandingFigure(voxels);
  addLine(voxels, -7, 21, -12, 15, 1, 0, 'primary');
  addLine(voxels, 7, 21, 12, 16, 1, 0, 'primary');
  addEllipse(voxels, -12, 14, 2, 2, 0, 0, 'skin');
  addEllipse(voxels, 12, 15, 2, 2, 0, 0, 'skin');

  addEllipse(voxels, 0, 34, 8, 2, 0, 0, 'helmet');
  addBox(voxels, -10, 10, 1, 1, 32, 33, 'helmet');
  addBox(voxels, -4, 4, 1, 1, 12, 20, 'soft');
  addBox(voxels, -5, -3, 2, 2, 19, 21, 'dark');
  addBox(voxels, 3, 5, 2, 2, 19, 21, 'dark');

  // A potted sprout on one side and a long field hoe on the other frame the worker.
  addPolygonExtrusion(
    voxels,
    [
      { x: -17, y: 4 },
      { x: -10, y: 4 },
      { x: -11, y: 10 },
      { x: -16, y: 10 },
    ],
    1,
    1,
    'soil',
  );
  addLine(voxels, -13, 10, -13, 22, 0, 1, 'leaf');
  addEllipse(voxels, -17, 18, 4, 2, 1, 1, 'leaf');
  addEllipse(voxels, -9, 21, 4, 2, 1, 1, 'leaf');
  addLine(voxels, 11, 18, 18, 1, 0, 1, 'wood');
  addLine(voxels, 15, 3, 22, 5, 1, 1, 'metal');
  return [...voxels.values()];
}

function engineerVoxels(): Voxel[] {
  const voxels = new Map<string, Voxel>();
  addStandingFigure(voxels);
  addLine(voxels, -7, 21, -11, 13, 1, 0, 'primary');
  addLine(voxels, 7, 21, 13, 27, 1, 0, 'primary');
  addEllipse(voxels, -11, 12, 2, 2, 0, 0, 'skin');
  addEllipse(voxels, 13, 28, 2, 2, 0, 0, 'skin');

  addEllipse(voxels, 0, 34, 7, 3, 0, 0, 'helmet');
  addBox(voxels, -8, 8, 1, 1, 32, 33, 'helmet');
  addLine(voxels, -6, 20, 5, 12, 1, 1, 'soft');

  // Raised open-ended wrench: ring grip, shaft, then a split jaw above the helmet.
  addEllipseRing(voxels, 13, 25, 3, 3, 1.4, 1, 'metal');
  addLine(voxels, 14, 27, 18, 38, 1, 1, 'metal');
  addLine(voxels, 18, 38, 15, 42, 1, 1, 'metal');
  addLine(voxels, 18, 38, 22, 40, 1, 1, 'metal');
  addEllipseRing(voxels, -11, 13, 5, 5, 1.7, 1, 'metal');
  addLine(voxels, -16, 13, -6, 13, 0, 2, 'dark');
  addLine(voxels, -11, 8, -11, 18, 0, 2, 'dark');
  return [...voxels.values()];
}

function operatorVoxels(): Voxel[] {
  const voxels = new Map<string, Voxel>();
  addStandingFigure(voxels);
  addLine(voxels, -7, 21, -9, 15, 1, 0, 'primary');
  addLine(voxels, 7, 21, 9, 15, 1, 0, 'primary');
  addEllipse(voxels, -9, 14, 2, 2, 0, 0, 'skin');
  addEllipse(voxels, 9, 14, 2, 2, 0, 0, 'skin');

  // Headband, ear cups and boom mic read as a headset even at thumbnail size.
  addEllipseRing(voxels, 0, 29, 7, 7, 1.5, 1, 'soft');
  addBox(voxels, -8, -6, 1, 1, 27, 31, 'dark');
  addBox(voxels, 6, 8, 1, 1, 27, 31, 'dark');
  addLine(voxels, -7, 28, -10, 25, 0, 2, 'metal');
  addLine(voxels, -10, 25, -7, 24, 0, 2, 'metal');

  // The console is a separate foreground mass with a luminous display and controls.
  addPolygonExtrusion(
    voxels,
    [
      { x: -15, y: 5 },
      { x: 15, y: 5 },
      { x: 13, y: 14 },
      { x: -13, y: 14 },
    ],
    1,
    1,
    'dark',
  );
  addBox(voxels, -10, 8, 2, 2, 9, 13, 'screen');
  addBox(voxels, -8, 3, 3, 3, 11, 11, 'paper-line');
  addBox(voxels, 10, 12, 2, 2, 10, 12, 'helmet');
  addBox(voxels, 11, 11, 3, 3, 11, 11, 'cross');
  return [...voxels.values()];
}

function medicVoxels(): Voxel[] {
  const voxels = new Map<string, Voxel>();
  addStandingFigure(voxels);
  addLine(voxels, -7, 21, -10, 13, 1, 0, 'white');
  addLine(voxels, 7, 21, 12, 13, 1, 0, 'white');
  addEllipse(voxels, -10, 12, 2, 2, 0, 0, 'skin');
  addEllipse(voxels, 12, 12, 2, 2, 0, 0, 'skin');

  addPolygonExtrusion(
    voxels,
    [
      { x: -7, y: 11 },
      { x: 7, y: 11 },
      { x: 7, y: 22 },
      { x: -7, y: 22 },
    ],
    1,
    1,
    'white',
  );
  addBox(voxels, -6, 6, 1, 1, 33, 35, 'white');
  addBox(voxels, -1, 1, 2, 2, 33, 35, 'cross');
  addBox(voxels, -3, 3, 2, 2, 34, 34, 'cross');
  addBox(voxels, -1, 1, 2, 2, 15, 21, 'cross');
  addBox(voxels, -4, 4, 2, 2, 17, 19, 'cross');

  // A handled medical bag repeats the cross at the figure's side.
  addBox(voxels, 9, 17, 1, 1, 4, 12, 'dark');
  addEllipseRing(voxels, 13, 13, 4, 4, 1.5, 1, 'metal');
  addBox(voxels, 12, 14, 2, 2, 6, 10, 'cross');
  addBox(voxels, 10, 16, 2, 2, 7, 9, 'cross');
  return [...voxels.values()];
}

function roleVoxels(role: CivicRole): Voxel[] {
  switch (role) {
    case 'architect':
      return architectVoxels();
    case 'cultivator':
      return cultivatorVoxels();
    case 'engineer':
      return engineerVoxels();
    case 'operator':
      return operatorVoxels();
    case 'medic':
      return medicVoxels();
  }
}

function materialFill(
  material: VoxelMaterial,
  palette: RoleProfile['palette'],
  colorNoise: number,
): string {
  switch (material) {
    case 'primary':
      return colorNoise > 0.72 ? palette.soft : colorNoise < 0.22 ? palette.dark : palette.primary;
    case 'dark':
      return palette.dark;
    case 'soft':
      return palette.soft;
    case 'skin':
      return '#d99b74';
    case 'helmet':
      return '#e6c84f';
    case 'paper':
      return '#bcebf0';
    case 'paper-line':
      return '#397c8c';
    case 'leaf':
      return '#72b943';
    case 'wood':
      return '#996338';
    case 'metal':
      return '#9baaa8';
    case 'screen':
      return '#74efb2';
    case 'white':
      return '#eee9df';
    case 'cross':
      return '#e34f66';
    case 'soil':
      return '#a56b3f';
  }
}

function createRoleTargets(role: CivicRole, count: number): MorphTarget[] {
  const candidates = roleVoxels(role).sort(
    (left, right) => left.z - right.z || left.y - right.y || left.x - right.x || left.material.localeCompare(right.material),
  );
  if (candidates.length === 0) throw new Error(`${role} sculpture has no voxels.`);

  // Every authored pixel is retained when the figure is sparser than the QR. Extra
  // modules converge on existing pixels, keeping the exact keyed QR module count
  // without punching random holes through a face, hand or profession-defining prop.
  const selected = Array.from({ length: count }, (_, index) => candidates.length <= count
    ? candidates[index % candidates.length]
    : candidates[Math.floor((index * candidates.length) / count)]);
  const projected = selected.map((voxel) => ({
    voxel,
    x: (voxel.x - voxel.y) * 5,
    y: (voxel.x + voxel.y) * 2.8 - voxel.z * 6.8,
  }));
  const xExtent = d3.extent(projected, (item) => item.x) as [number, number];
  const yExtent = d3.extent(projected, (item) => item.y) as [number, number];
  const fit = Math.min(1.85, 500 / (xExtent[1] - xExtent[0] + 12), 455 / (yExtent[1] - yExtent[0] + 14));
  const offsetX = 360 - ((xExtent[0] + xExtent[1]) / 2) * fit;
  const offsetY = 350 - ((yExtent[0] + yExtent[1]) / 2) * fit;
  const palette = roleProfiles[role].palette;
  const width = 10 * fit;
  const height = 5.6 * fit;

  return projected
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((item, index) => {
      const colorNoise = pseudo(item.voxel.x, item.voxel.y, item.voxel.z + index);
      return {
        path: voxelPath(
          { x: item.x * fit + offsetX, y: item.y * fit + offsetY },
          width,
          height,
        ),
        fill: materialFill(item.voxel.material, palette, colorNoise),
      };
    });
}

function createMorphModules(): MorphModule[] {
  const qrCode = QRCode.create(QR_DESTINATION_URL, { errorCorrectionLevel: 'H' });
  const matrixSize = qrCode.modules.size;
  const moduleSize = QR_FIELD_SIZE / (matrixSize + QR_QUIET_ZONE * 2);
  const darkModules: Array<{
    id: string;
    qrPath: string;
    planePath: string;
    wave: number;
    isFinder: boolean;
  }> = [];
  const matrixCenter = (matrixSize - 1) / 2;
  const maximumDistance = Math.hypot(matrixCenter, matrixCenter) || 1;

  for (let row = 0; row < matrixSize; row += 1) {
    for (let column = 0; column < matrixSize; column += 1) {
      if (!qrCode.modules.get(row, column)) continue;
      const x = QR_FIELD_ORIGIN + (column + QR_QUIET_ZONE) * moduleSize;
      const y = QR_FIELD_ORIGIN + (row + QR_QUIET_ZONE) * moduleSize;
      darkModules.push({
        id: `${row}:${column}`,
        qrPath: qrSquarePath(x, y, moduleSize),
        planePath: planeSquarePath(x, y, moduleSize),
        wave: Math.hypot(column - matrixCenter, row - matrixCenter) / maximumDistance,
        isFinder: isFinderModule(row, column, matrixSize),
      });
    }
  }

  const sculptureModuleCount = darkModules.filter((module) => !module.isFinder).length;

  const targetSets = Object.fromEntries(
    civicRoles.map((role) => [role, createRoleTargets(role, sculptureModuleCount)]),
  ) as Record<CivicRole, MorphTarget[]>;

  let sculptureIndex = 0;

  return darkModules.map((module) => {
    const targetIndex = module.isFinder ? -1 : sculptureIndex++;
    return {
      id: module.id,
      qrPath: module.qrPath,
      planePath: module.planePath,
      wave: module.wave,
      isFinder: module.isFinder,
      targets: Object.fromEntries(
        civicRoles.map((role) => [
          role,
          module.isFinder
            ? { path: module.planePath, fill: roleProfiles[role].palette.dark }
            : targetSets[role][targetIndex],
        ]),
      ) as Record<CivicRole, MorphTarget>,
    };
  });
}

function setMorphLock(locked: boolean): void {
  morphLocked = locked;
  morphTrigger.disabled = locked;
  morphTrigger.setAttribute('aria-busy', String(locked));
  morphSvg.setAttribute('aria-busy', String(locked));
  studioRoleInputs.forEach((input) => {
    input.disabled = locked;
  });
}

function updateMorphLabels(): void {
  const profile = roleProfiles[selectedStudioRole];
  const sculptureVisible = studioMode === 'sculpture';
  morphTrigger.setAttribute('aria-pressed', String(sculptureVisible));
  morphTrigger.setAttribute(
    'aria-label',
    sculptureVisible
      ? `Restore the flat scannable ${profile.label} QR code`
      : `Transform the QR code into ${profile.object}`,
  );
  morphTapLabel.textContent = sculptureVisible
    ? 'Tap the object to restore the scannable code'
    : `Tap the code to build ${profile.label}`;
  morphTitle.textContent = sculptureVisible
    ? `${profile.label} role sculpture hidden inside the AFTERHOURS code`
    : 'Scannable QR code for the AFTERHOURS poster';
  morphDescription.textContent = sculptureVisible
    ? `A procedural isometric ${profile.object}; tap to return every module to the flat QR code.`
    : `A flat high-contrast QR code that opens ${QR_DESTINATION_URL} and can transform into ${profile.object}.`;
}

function updateStudioRoleUi(): void {
  const profile = roleProfiles[selectedStudioRole];
  qrDialog.dataset.role = selectedStudioRole;
  qrDialog.style.setProperty('--role-primary', profile.palette.primary);
  qrDialog.style.setProperty('--role-dark', profile.palette.dark);
  qrDialog.style.setProperty('--role-soft', profile.palette.soft);
  studioRoleKicker.textContent = profile.kicker;
  studioRoleTitle.textContent = `${profile.label.toUpperCase()} SIGNAL`;
  studioRoleDescription.textContent = profile.copy;
  studioRoleInputs.forEach((input) => {
    input.checked = input.value === selectedStudioRole;
  });
  updateMorphLabels();
}

function setExactMorphState(): void {
  const profile = roleProfiles[selectedStudioRole];
  const sculptureVisible = studioMode === 'sculpture';
  moduleSelection
    .attr('d', (module) => sculptureVisible ? module.targets[selectedStudioRole].path : module.qrPath)
    .attr('fill', (module) => sculptureVisible ? module.targets[selectedStudioRole].fill : profile.palette.dark)
    .attr('stroke', (module) => sculptureVisible && !module.isFinder ? '#f6f1e7' : 'none')
    .attr('stroke-width', (module) => sculptureVisible && !module.isFinder ? 0.9 : 0);

  if (sculptureVisible) {
    morphPlate.setAttribute('transform', PLANE_MATRIX);
    plateSelection.attr('fill', '#fbf8f1').attr('stroke', profile.palette.soft);
  } else {
    morphPlate.removeAttribute('transform');
    plateSelection.attr('fill', '#fffdf8').attr('stroke', '#d9d0c2');
  }
  qrDialog.dataset.view = studioMode;
  renderedStudioMode = studioMode;
  renderedStudioRole = selectedStudioRole;
  updateMorphLabels();
}

async function renderMorph(instant = false, announce = true): Promise<void> {
  const revision = ++morphRevision;
  const targetMode = studioMode;
  const targetRole = selectedStudioRole;
  const previousMode = renderedStudioMode;
  const previousRole = renderedStudioRole;
  const profile = roleProfiles[targetRole];
  setMorphLock(true);
  studioMorphStatus.textContent = '';
  moduleSelection.interrupt();
  plateSelection.interrupt();

  if (instant || reducedMotion) {
    setExactMorphState();
    setMorphLock(false);
    if (announce) {
      studioMorphStatus.textContent = targetMode === 'qr'
        ? `Scannable ${profile.label} code restored.`
        : `${profile.label} ${profile.object} revealed.`;
    }
    return;
  }

  qrDialog.dataset.view = 'transition';

  try {
    if (previousMode === 'qr' && targetMode === 'sculpture') {
      const tiltModules = moduleSelection
        .transition()
        .duration(180)
        .ease(d3.easeCubicInOut)
        .attrTween('d', function (module) {
          return d3.interpolateString(this.getAttribute('d') || module.qrPath, module.planePath);
        })
        .attr('fill', profile.palette.dark)
        .attr('stroke', 'none')
        .attr('stroke-width', 0);
      const tiltPlate = plateSelection
        .transition()
        .duration(180)
        .ease(d3.easeCubicInOut)
        .attr('transform', PLANE_MATRIX)
        .attr('fill', '#fbf8f1')
        .attr('stroke', profile.palette.soft);
      await Promise.all([tiltModules.end(), tiltPlate.end()]);
      if (revision !== morphRevision) return;

      moduleSelection
        .attr('stroke', (module) => module.isFinder ? 'none' : '#f6f1e7')
        .attr('stroke-width', 0);
      const extrudeModules = moduleSelection
        .transition()
        .delay((module) => module.isFinder ? 0 : module.wave * 90)
        .duration((module) => module.isFinder ? 1 : 370)
        .ease(d3.easeCubicOut)
        .attrTween('d', function (module) {
          return d3.interpolateString(
            this.getAttribute('d') || module.planePath,
            module.targets[targetRole].path,
          );
        })
        .attr('fill', (module) => module.targets[targetRole].fill)
        .attr('stroke-width', (module) => module.isFinder ? 0 : 0.9);
      await extrudeModules.end();
    } else if (previousMode === 'sculpture' && targetMode === 'qr') {
      const contractModules = moduleSelection
        .transition()
        .delay((module) => module.isFinder ? 0 : (1 - module.wave) * 50)
        .duration((module) => module.isFinder ? 1 : 380)
        .ease(d3.easeCubicInOut)
        .attrTween('d', function (module) {
          return d3.interpolateString(this.getAttribute('d') || module.targets[previousRole].path, module.planePath);
        })
        .attr('fill', profile.palette.dark)
        .attr('stroke-width', 0);
      await contractModules.end();
      if (revision !== morphRevision) return;

      moduleSelection.attr('stroke', 'none');
      const flattenModules = moduleSelection
        .transition()
        .duration(210)
        .ease(d3.easeCubicInOut)
        .attrTween('d', function (module) {
          return d3.interpolateString(this.getAttribute('d') || module.planePath, module.qrPath);
        })
        .attr('fill', profile.palette.dark)
        .attr('stroke-width', 0);
      const flattenPlate = plateSelection
        .transition()
        .duration(210)
        .ease(d3.easeCubicInOut)
        .attr('transform', null)
        .attr('fill', '#fffdf8')
        .attr('stroke', '#d9d0c2');
      await Promise.all([flattenModules.end(), flattenPlate.end()]);
    } else if (targetMode === 'sculpture') {
      const swapModules = moduleSelection
        .transition()
        .delay((module) => module.isFinder ? 0 : module.wave * 55)
        .duration((module) => module.isFinder ? 180 : 485)
        .ease(d3.easeCubicInOut)
        .attrTween('d', function (module) {
          return d3.interpolateString(
            this.getAttribute('d') || module.targets[previousRole].path,
            module.targets[targetRole].path,
          );
        })
        .attr('fill', (module) => module.targets[targetRole].fill)
        .attr('stroke', (module) => module.isFinder ? 'none' : '#f6f1e7')
        .attr('stroke-width', (module) => module.isFinder ? 0 : 0.9);
      const swapPlate = plateSelection
        .transition()
        .duration(300)
        .ease(d3.easeCubicInOut)
        .attr('stroke', profile.palette.soft);
      await Promise.all([swapModules.end(), swapPlate.end()]);
    } else {
      const recolorModules = moduleSelection
        .transition()
        .duration(220)
        .ease(d3.easeCubicInOut)
        .attr('d', (module) => module.qrPath)
        .attr('fill', profile.palette.dark)
        .attr('stroke', 'none')
        .attr('stroke-width', 0);
      await recolorModules.end();
    }
  } catch {
    if (revision !== morphRevision) return;
  }

  if (revision !== morphRevision) return;
  setExactMorphState();
  setMorphLock(false);
  if (announce) {
    studioMorphStatus.textContent = targetMode === 'qr'
      ? `Scannable ${profile.label} code restored.`
      : `${profile.label} ${profile.object} revealed.`;
  }
}

function polygon(points: Point[], fill: string, stroke?: string): void {
  if (points.length === 0) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.stroke();
  }
}

function interpolate(start: Point, end: Point, amount: number): Point {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function drawWindows(
  roofStart: Point,
  roofEnd: Point,
  height: number,
  floors: number,
  columns: number,
  seedX: number,
  seedY: number,
  sideSalt: number,
  scale: number,
  profile: GridProfile,
): void {
  const windowHeight = Math.max(1.2, scale * 2.55);
  for (let floor = 0; floor < floors; floor += 1) {
    const vertical = ((floor + 0.78) / (floors + 0.42)) * height;
    for (let column = 0; column < columns; column += 1) {
      const startAmount = (column + 0.2) / columns;
      const endAmount = (column + 0.7) / columns;
      const topStart = interpolate(roofStart, roofEnd, startAmount);
      const topEnd = interpolate(roofStart, roofEnd, endAmount);
      const lit = pseudo(seedX * 9 + column, seedY * 11 + floor, sideSalt) < profile.litChance;
      context.globalAlpha = lit ? 0.74 + pseudo(column, floor, seedX + seedY) * 0.24 : 0.18;
      polygon(
        [
          { x: topStart.x, y: topStart.y + vertical },
          { x: topEnd.x, y: topEnd.y + vertical },
          { x: topEnd.x, y: topEnd.y + vertical + windowHeight },
          { x: topStart.x, y: topStart.y + vertical + windowHeight },
        ],
        lit ? profile.window : '#17372a',
      );
    }
  }
  context.globalAlpha = 1;
}

function drawBackdrop(width: number, height: number, time: number, shift: ShiftProfile): void {
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, shift.skyTop);
  sky.addColorStop(0.66, shift.skyBottom);
  sky.addColorStop(1, '#020705');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.68, height * 0.48, 0, width * 0.68, height * 0.48, width * 0.45);
  glow.addColorStop(0, `${shift.horizon}36`);
  glow.addColorStop(0.38, `${shift.horizon}10`);
  glow.addColorStop(1, `${shift.horizon}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const starCount = Math.floor(95 * shift.stars);
  for (let index = 0; index < starCount; index += 1) {
    const depth = 0.22 + pseudo(index, 1, 5) * 0.78;
    const x = pseudo(index, 2, 8) * width + motion.x * 8 * depth;
    const y = pseudo(index, 4, 3) * height * 0.56 + motion.y * 4 * depth;
    const flicker = reducedMotion ? 0.7 : 0.48 + Math.sin(time * 0.001 + index) * 0.22;
    context.globalAlpha = Math.max(0.16, flicker) * shift.stars;
    context.fillStyle = index % 11 === 0 ? '#d8ff63' : '#d9efe2';
    context.beginPath();
    context.arc(x, y, index % 9 === 0 ? 1.25 : 0.65, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  context.beginPath();
  context.moveTo(0, height * 0.72);
  for (let index = 0; index <= 16; index += 1) {
    const x = (index / 16) * width;
    const y = height * (0.61 + pseudo(index, 7, 2) * 0.12);
    context.lineTo(x, y);
  }
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = 'rgba(2, 10, 7, 0.76)';
  context.fill();
}

function drawBuilding(
  cellX: number,
  cellY: number,
  project: (x: number, y: number, z?: number) => Point,
  scale: number,
  profile: GridProfile,
  pressure: PressureProfile,
): void {
  if (pseudo(cellX, cellY, 1) > 0.79) return;

  const height = (38 + pseudo(cellX, cellY, 4) * 112) * scale;
  const inset = 0.13 + pseudo(cellX, cellY, 6) * 0.08;
  const outer = 1 - inset;
  const base = [
    project(cellX + inset, cellY + inset),
    project(cellX + outer, cellY + inset),
    project(cellX + outer, cellY + outer),
    project(cellX + inset, cellY + outer),
  ];
  const roof = [
    project(cellX + inset, cellY + inset, height),
    project(cellX + outer, cellY + inset, height),
    project(cellX + outer, cellY + outer, height),
    project(cellX + inset, cellY + outer, height),
  ];
  const hue = state.shift === 'dawn' ? 22 : state.shift === 'dusk' ? 163 : 151;
  const variation = Math.round(pseudo(cellX, cellY, 12) * 4);
  context.lineWidth = Math.max(0.5, scale * 0.65);
  polygon([roof[3], roof[2], base[2], base[3]], `hsl(${hue} 31% ${8 + variation}%)`, 'rgba(93, 174, 128, 0.12)');
  polygon([roof[1], roof[2], base[2], base[1]], `hsl(${hue} 35% ${6 + variation}%)`, 'rgba(93, 174, 128, 0.1)');
  polygon(roof, `hsl(${hue} 28% ${13 + variation}%)`, 'rgba(112, 214, 154, 0.18)');

  const floors = Math.max(2, Math.min(8, Math.floor(height / Math.max(8, scale * 14))));
  const columns = height > 90 * scale ? 3 : 2;
  drawWindows(roof[3], roof[2], height, floors, columns, cellX, cellY, 19, scale, profile);
  drawWindows(roof[1], roof[2], height, floors, columns, cellX, cellY, 41, scale, profile);

  if (pseudo(cellX, cellY, 22) < pressure.beacons) {
    const beacon = interpolate(roof[0], roof[2], 0.5);
    context.fillStyle = pressure.accent;
    context.shadowColor = pressure.accent;
    context.shadowBlur = 9 * scale;
    context.beginPath();
    context.arc(beacon.x, beacon.y - 2 * scale, Math.max(1.1, scale * 1.8), 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  }
}

function drawCore(
  project: (x: number, y: number, z?: number) => Point,
  scale: number,
  time: number,
  pressure: PressureProfile,
): Point {
  const ground = project(5.5, 5.5);
  const towerHeight = 102 * scale;
  const orb = { x: ground.x, y: ground.y - towerHeight };
  const diamondWidth = 34 * scale;
  const diamondHeight = 17 * scale;

  context.save();
  context.globalAlpha = 0.5;
  context.strokeStyle = pressure.accent;
  context.lineWidth = Math.max(0.8, scale);
  for (let ring = 0; ring < 3; ring += 1) {
    const radius = (26 + ring * 15) * scale;
    context.beginPath();
    context.ellipse(ground.x, ground.y, radius, radius * 0.48, 0, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();

  polygon(
    [
      { x: ground.x, y: ground.y - diamondHeight },
      { x: ground.x + diamondWidth, y: ground.y },
      { x: ground.x, y: ground.y + diamondHeight },
      { x: ground.x - diamondWidth, y: ground.y },
    ],
    'rgba(6, 27, 19, 0.96)',
    pressure.accent,
  );

  const stemWidth = 10 * scale;
  polygon(
    [
      { x: ground.x - stemWidth, y: ground.y - 5 * scale },
      { x: ground.x, y: ground.y },
      { x: orb.x, y: orb.y + 4 * scale },
      { x: orb.x - stemWidth, y: orb.y + 8 * scale },
    ],
    '#0f3d2b',
  );
  polygon(
    [
      { x: ground.x, y: ground.y },
      { x: ground.x + stemWidth, y: ground.y - 5 * scale },
      { x: orb.x + stemWidth, y: orb.y + 8 * scale },
      { x: orb.x, y: orb.y + 4 * scale },
    ],
    '#08251a',
  );

  const phase = reducedMotion ? 0.42 : (time * pressure.pulseSpeed) % 1;
  for (let index = 0; index < 3; index += 1) {
    const ringPhase = (phase + index / 3) % 1;
    context.globalAlpha = (1 - ringPhase) * 0.62;
    context.strokeStyle = pressure.accent;
    context.lineWidth = Math.max(0.8, scale * 1.2);
    context.beginPath();
    context.arc(orb.x, orb.y, (8 + ringPhase * 42) * scale, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.shadowColor = pressure.accent;
  context.shadowBlur = 28 * scale;
  context.fillStyle = pressure.accent;
  context.beginPath();
  context.arc(orb.x, orb.y, Math.max(3.5, scale * 5), 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  return orb;
}

function drawAtmosphere(width: number, height: number, time: number, pressure: PressureProfile, scale: number): void {
  if (pressure.rain === 0) return;
  context.lineWidth = Math.max(0.5, scale * 0.65);
  context.strokeStyle = pressure.accent;
  context.globalAlpha = state.pressure === 'cascade' ? 0.16 : 0.08;
  for (let index = 0; index < pressure.rain; index += 1) {
    const x = pseudo(index, 18, 4) * width;
    const travel = reducedMotion ? 0 : time * (0.045 + pseudo(index, 9, 2) * 0.06);
    const y = (pseudo(index, 33, 8) * height + travel) % height;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - 7 * scale, y + 18 * scale);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawCity(time: number): void {
  if (viewWidth <= 0 || viewHeight <= 0) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, viewWidth, viewHeight);

  const shift = shifts[state.shift];
  const grid = grids[state.grid];
  const pressure = pressures[state.pressure];
  drawBackdrop(viewWidth, viewHeight, time, shift);

  const scale = Math.max(0.44, Math.min(1.18, viewWidth / 1020, viewHeight / 660));
  const tileWidth = 68 * scale;
  const tileHeight = 34 * scale;
  const originX = viewWidth * (viewWidth < 700 ? 0.57 : 0.65) + motion.x * 20 * scale;
  const originY = viewHeight * (viewWidth < 700 ? 0.28 : 0.18) + motion.y * 12 * scale;
  const project = (x: number, y: number, z = 0): Point => ({
    x: originX + (x - y) * tileWidth * 0.5,
    y: originY + (x + y) * tileHeight * 0.5 - z,
  });

  const worldSize = 11;
  context.lineWidth = Math.max(0.45, scale * 0.58);
  for (let sum = 0; sum <= (worldSize - 1) * 2; sum += 1) {
    for (let cellX = 0; cellX < worldSize; cellX += 1) {
      const cellY = sum - cellX;
      if (cellY < 0 || cellY >= worldSize) continue;
      const road = cellX === 5 || cellY === 5;
      const tile = [
        project(cellX, cellY),
        project(cellX + 1, cellY),
        project(cellX + 1, cellY + 1),
        project(cellX, cellY + 1),
      ];
      polygon(
        tile,
        road ? 'rgba(2, 13, 9, 0.96)' : pseudo(cellX, cellY, 31) > 0.5 ? '#09251a' : '#0b2b1f',
        road ? 'rgba(76, 128, 96, 0.16)' : 'rgba(78, 159, 112, 0.1)',
      );

      if (road) {
        const start = project(cellX + 0.5, cellY + 0.5);
        const end = cellX === 5 ? project(cellX + 0.5, cellY + 1) : project(cellX + 1, cellY + 0.5);
        context.globalAlpha = grid.veinAlpha;
        context.strokeStyle = grid.vein;
        context.shadowColor = grid.vein;
        context.shadowBlur = 5 * scale;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.shadowBlur = 0;
        context.globalAlpha = 1;
      }
    }
  }

  for (let sum = 0; sum <= (worldSize - 1) * 2; sum += 1) {
    for (let cellX = 0; cellX < worldSize; cellX += 1) {
      const cellY = sum - cellX;
      if (cellY < 0 || cellY >= worldSize || cellX === 5 || cellY === 5) continue;
      drawBuilding(cellX, cellY, project, scale, grid, pressure);
    }
  }

  const core = drawCore(project, scale, time, pressure);
  drawAtmosphere(viewWidth, viewHeight, time, pressure, scale);
  updateCoreTarget(core);
}

function updateCoreTarget(core: Point): void {
  if (Math.abs(core.x - lastCoreX) < 0.5 && Math.abs(core.y - lastCoreY) < 0.5) return;
  lastCoreX = core.x;
  lastCoreY = core.y;
  coreTarget.style.left = `${core.x}px`;
  coreTarget.style.top = `${core.y}px`;
}

function resizeCanvas(): void {
  const bounds = cityTrigger.getBoundingClientRect();
  viewWidth = Math.max(1, bounds.width);
  viewHeight = Math.max(1, bounds.height);
  pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const nextWidth = Math.round(viewWidth * pixelRatio);
  const nextHeight = Math.round(viewHeight * pixelRatio);
  if (cityCanvas.width !== nextWidth || cityCanvas.height !== nextHeight) {
    cityCanvas.width = nextWidth;
    cityCanvas.height = nextHeight;
  }
  drawCity(reducedMotion ? 0 : performance.now());
  beginLoop();
}

function animate(time: number): void {
  frameRequest = 0;
  const easing = 0.085;
  motion.x += (motion.targetX - motion.x) * easing;
  motion.y += (motion.targetY - motion.y) * easing;
  if (time - previousFrame >= 1000 / 30) {
    previousFrame = time;
    drawCity(time);
  }
  beginLoop();
}

function beginLoop(): void {
  if (reducedMotion || document.hidden || qrDialog.open || frameRequest !== 0) return;
  frameRequest = window.requestAnimationFrame(animate);
}

function stopLoop(): void {
  if (frameRequest !== 0) window.cancelAnimationFrame(frameRequest);
  frameRequest = 0;
}

function updateStateUi(): void {
  const shift = shifts[state.shift];
  const grid = grids[state.grid];
  const pressure = pressures[state.pressure];
  posterShell.dataset.shift = state.shift;
  posterShell.dataset.grid = state.grid;
  posterShell.dataset.pressure = state.pressure;
  shiftReadout.textContent = shift.time;
  gridReadout.textContent = `${grid.value}%`;
  pressureReadout.textContent = `${pressure.value}%`;
  stateNarrative.textContent = `${shift.message} ${grid.message} ${pressure.message}`;

  for (const [name, value] of Object.entries(state)) {
    const input = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }
}

function updateDisplayUrl(): void {
  const rosterUrl = new URL('/', window.location.origin);
  rosterUrl.searchParams.set('c', CAMPAIGN);
  rosterUrl.searchParams.set('utm_source', 'interactive_poster');
  rosterUrl.searchParams.set('utm_medium', 'cta');
  rosterUrl.searchParams.set('utm_campaign', 'afterhours_launch');
  rosterUrl.searchParams.set('utm_content', 'poster_hero');
  rosterUrl.searchParams.set('role', selectedStudioRole);
  rosterUrl.hash = 'join';
  waitlistLink.href = rosterUrl.toString();
  waitlistRoleLabel.textContent = `Join the ${roleProfiles[selectedStudioRole].label} waitlist`;
  waitlistLink.setAttribute(
    'aria-label',
    `Join the ${roleProfiles[selectedStudioRole].label} founding waitlist`,
  );

  if (!/^https?:$/.test(window.location.protocol)) return;
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('shift', state.shift);
  url.searchParams.set('grid', state.grid);
  url.searchParams.set('pressure', state.pressure);
  url.searchParams.set('role', selectedStudioRole);
  window.history.replaceState(null, '', url);
}

function posterShareUrl(): string {
  const url = new URL(POSTER_SHARE_URL);
  url.searchParams.set('shift', state.shift);
  url.searchParams.set('grid', state.grid);
  url.searchParams.set('pressure', state.pressure);
  url.searchParams.set('role', selectedStudioRole);
  return url.toString();
}

function handleStateChange(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !input.checked) return;
  if (input.name === 'shift' && ['dusk', 'deep', 'dawn'].includes(input.value)) {
    state = { ...state, shift: input.value as Shift };
  } else if (input.name === 'grid' && ['strained', 'stable', 'surplus'].includes(input.value)) {
    state = { ...state, grid: input.value as Grid };
  } else if (input.name === 'pressure' && ['watch', 'critical', 'cascade'].includes(input.value)) {
    state = { ...state, pressure: input.value as Pressure };
  } else {
    return;
  }
  updateStateUi();
  updateDisplayUrl();
  trackPoster('poster_midpoint');
  drawCity(reducedMotion ? 0 : performance.now());
  beginLoop();
}

function updatePointer(event: PointerEvent): void {
  if (reducedMotion) return;
  const bounds = cityTrigger.getBoundingClientRect();
  motion.targetX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
  motion.targetY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1));
  beginLoop();
}

function handlePointerDown(event: PointerEvent): void {
  pointerStart = { x: event.clientX, y: event.clientY };
  pointerDistance = 0;
  cityTrigger.setPointerCapture(event.pointerId);
  updatePointer(event);
}

function handlePointerMove(event: PointerEvent): void {
  updatePointer(event);
  if (!pointerStart) return;
  pointerDistance = Math.max(pointerDistance, Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y));
}

function handlePointerEnd(event: PointerEvent): void {
  if (cityTrigger.hasPointerCapture(event.pointerId)) cityTrigger.releasePointerCapture(event.pointerId);
  suppressNextClick = pointerDistance > 11;
  if (suppressNextClick) {
    window.setTimeout(() => {
      suppressNextClick = false;
    }, 0);
  }
  pointerStart = null;
  motion.targetX = 0;
  motion.targetY = 0;
  beginLoop();
}

function handlePointerCancel(event: PointerEvent): void {
  if (cityTrigger.hasPointerCapture(event.pointerId)) cityTrigger.releasePointerCapture(event.pointerId);
  pointerStart = null;
  pointerDistance = 0;
  suppressNextClick = false;
  motion.targetX = 0;
  motion.targetY = 0;
  beginLoop();
}

async function revealSignal(): Promise<void> {
  if (revealInProgress || qrDialog.open) return;
  revealInProgress = true;
  studioMode = 'qr';
  await renderMorph(true, false);
  cityTrigger.setAttribute('aria-expanded', 'true');
  stopLoop();
  posterShell.classList.add('is-revealing');
  if (!reducedMotion) await new Promise<void>((resolve) => window.setTimeout(resolve, 360));
  if (!qrDialog.open) qrDialog.showModal();
  posterShell.classList.remove('is-revealing');
  revealInProgress = false;
  trackPoster('poster_completed');
}

function handleStudioRoleChange(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.checked) return;
  if (morphLocked) {
    studioRoleInputs.forEach((roleInput) => {
      roleInput.checked = roleInput.value === selectedStudioRole;
    });
    return;
  }
  const nextRole = oneOf(input.value, civicRoles, selectedStudioRole);
  if (nextRole === selectedStudioRole) return;
  selectedStudioRole = nextRole;
  updateStudioRoleUi();
  updateDisplayUrl();
  trackPoster('poster_midpoint');
  void renderMorph();
}

function showStatus(message: string): void {
  window.clearTimeout(statusTimer);
  shareStatus.textContent = message;
  statusTimer = window.setTimeout(() => {
    shareStatus.textContent = '';
  }, 4200);
}

function fallbackCopy(value: string): boolean {
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  return copied;
}

async function sharePoster(): Promise<void> {
  trackPoster('poster_midpoint');
  const url = posterShareUrl();
  const shareData = {
    title: 'AFTERHOURS // City Signal',
    text: 'Tune the city. Reveal the signal. Take a shift.',
    url,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showStatus('Signal shared.');
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else if (!fallbackCopy(url)) {
      throw new Error('Copy was not accepted.');
    }
    showStatus('Poster link copied.');
  } catch {
    showStatus('Could not copy the link. The poster remains at /poster.');
  }
}

document.querySelectorAll<HTMLInputElement>('.state-selector input').forEach((input) => {
  input.addEventListener('change', handleStateChange);
});

studioRoleInputs.forEach((input) => {
  input.addEventListener('change', handleStudioRoleChange);
});

cityTrigger.addEventListener('pointerdown', handlePointerDown);
cityTrigger.addEventListener('pointermove', handlePointerMove);
cityTrigger.addEventListener('pointerup', handlePointerEnd);
cityTrigger.addEventListener('pointercancel', handlePointerCancel);
cityTrigger.addEventListener('pointerleave', () => {
  if (pointerStart) return;
  motion.targetX = 0;
  motion.targetY = 0;
  beginLoop();
});
cityTrigger.addEventListener('click', (event) => {
  if (suppressNextClick) {
    event.preventDefault();
    suppressNextClick = false;
    return;
  }
  void revealSignal();
});

shareButton.addEventListener('click', () => void sharePoster());
waitlistLink.addEventListener('click', () => {
  trackPoster('cta_clicked', {
    role: selectedStudioRole,
    placement: 'hero',
    destination: 'waitlist',
  });
});
studioShareButton.addEventListener('click', () => void sharePoster());
morphTrigger.addEventListener('click', () => {
  if (morphLocked) return;
  studioMode = studioMode === 'qr' ? 'sculpture' : 'qr';
  trackPoster('poster_midpoint');
  void renderMorph();
});
qrDialog.addEventListener('close', () => {
  posterShell.classList.remove('is-revealing');
  revealInProgress = false;
  studioMode = 'qr';
  void renderMorph(true, false);
  cityTrigger.setAttribute('aria-expanded', 'false');
  cityTrigger.focus({ preventScroll: true });
  beginLoop();
});
qrDialog.addEventListener('click', (event) => {
  if (event.target === qrDialog) qrDialog.close();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else beginLoop();
});

reducedMotionQuery.addEventListener('change', (event) => {
  reducedMotion = event.matches;
  motion.x = 0;
  motion.y = 0;
  motion.targetX = 0;
  motion.targetY = 0;
  if (reducedMotion) stopLoop();
  if (qrDialog.open) void renderMorph(true, false);
  drawCity(reducedMotion ? 0 : performance.now());
  beginLoop();
});

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(cityTrigger);
updateStateUi();
updateStudioRoleUi();
void renderMorph(true, false);
updateDisplayUrl();
resizeCanvas();
trackPoster('poster_started');
