type PulseRole = 'architect' | 'cultivator' | 'engineer' | 'operator' | 'medic';
type MetricKey = 'food' | 'power' | 'stability';

interface CityVitals {
  food: number;
  power: number;
  stability: number;
}

interface AxialCell {
  q: number;
  r: number;
}

interface DrawCell extends AxialCell {
  x: number;
  y: number;
}

interface RoleProfile {
  label: string;
  color: string;
  origin: AxialCell;
  impact: CityVitals;
  message: string;
}

interface PulseState {
  elapsed: number;
  role: PulseRole;
}

const METRICS: readonly MetricKey[] = ['food', 'power', 'stability'];
const PULSE_DURATION = 1_450;
const CITY_RADIUS = 2;
const MAX_HEX_DISTANCE = CITY_RADIUS * 2;

const ROLE_PROFILES: Record<PulseRole, RoleProfile> = {
  architect: {
    label: 'Architect',
    color: '#59f59a',
    origin: { q: 0, r: 0 },
    impact: { food: 2, power: -5, stability: 12 },
    message: 'A new shelter route locks in. Construction strains the grid, but the city gains breathing room.',
  },
  cultivator: {
    label: 'Cultivator',
    color: '#b7f45b',
    origin: { q: -2, r: 0 },
    impact: { food: 18, power: -1, stability: 3 },
    message: 'Fresh rations reach the outer ring. Hunger retreats a block.',
  },
  engineer: {
    label: 'Systems Engineer',
    color: '#62ddff',
    origin: { q: 2, r: -2 },
    impact: { food: -4, power: 12, stability: 7 },
    message: 'A failing relay comes back online. The night crew burns rations, but the network steadies itself.',
  },
  operator: {
    label: 'Grid Operator',
    color: '#ffc968',
    origin: { q: 2, r: 0 },
    impact: { food: -1, power: 19, stability: 3 },
    message: 'Power reroutes through the night grid. Three districts light up.',
  },
  medic: {
    label: 'Civic Medic',
    color: '#ff6c7a',
    origin: { q: 0, r: 2 },
    impact: { food: -1, power: -1, stability: 19 },
    message: 'Care teams deploy. Panic drops from a roar to a manageable hum.',
  },
};

const CITY_CELLS = createCityCells();
const STAR_FIELD = Array.from({ length: 26 }, (_, index) => ({
  x: fractional(Math.sin((index + 1) * 78.233) * 43_758.5453),
  y: fractional(Math.sin((index + 1) * 39.425) * 12_345.6789),
  alpha: 0.12 + (index % 5) * 0.045,
  radius: index % 7 === 0 ? 1.25 : 0.7,
}));

function fractional(value: number): number {
  return value - Math.floor(value);
}

function createCityCells(): AxialCell[] {
  const cells: AxialCell[] = [];
  for (let q = -CITY_RADIUS; q <= CITY_RADIUS; q += 1) {
    const minimumR = Math.max(-CITY_RADIUS, -q - CITY_RADIUS);
    const maximumR = Math.min(CITY_RADIUS, -q + CITY_RADIUS);
    for (let r = minimumR; r <= maximumR; r += 1) cells.push({ q, r });
  }
  return cells;
}

function isPulseRole(candidate: string | undefined): candidate is PulseRole {
  return Boolean(candidate && candidate in ROLE_PROFILES);
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function readMetric(element: HTMLElement | null, fallback: number): number {
  const source = element?.getAttribute('aria-valuenow') ?? element?.textContent ?? '';
  const value = Number.parseFloat(source.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(value) ? Math.round(clamp(value)) : fallback;
}

function hexDistance(first: AxialCell, second: AxialCell): number {
  const q = first.q - second.q;
  const r = first.r - second.r;
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

function hexPath(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  for (let side = 0; side < 6; side += 1) {
    const angle = Math.PI / 6 + side * (Math.PI / 3);
    const pointX = x + Math.cos(angle) * radius;
    const pointY = y + Math.sin(angle) * radius;
    if (side === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function mountCityPulse(root: HTMLElement): () => void {
  const canvasElement = root.querySelector<HTMLCanvasElement>('[data-city-canvas]');
  if (!canvasElement) return () => undefined;
  const canvasContext = canvasElement.getContext('2d');
  if (!canvasContext) return () => undefined;
  const canvas = canvasElement;
  const context = canvasContext;

  const metricElements: Record<MetricKey, HTMLElement | null> = {
    food: root.querySelector<HTMLElement>('[data-pulse-food]'),
    power: root.querySelector<HTMLElement>('[data-pulse-power]'),
    stability: root.querySelector<HTMLElement>('[data-pulse-stability]'),
  };
  const progressElements: Record<MetricKey, HTMLElement | null> = {
    food: root.querySelector<HTMLElement>('[data-pulse-food-progress]'),
    power: root.querySelector<HTMLElement>('[data-pulse-power-progress]'),
    stability: root.querySelector<HTMLElement>('[data-pulse-stability-progress]'),
  };
  const stateElement = root.querySelector<HTMLElement>('[data-pulse-state]');
  const messageElement = root.querySelector<HTMLElement>('[data-pulse-message]');
  const roleButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-pulse-role]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let vitals: CityVitals = {
    food: readMetric(metricElements.food, 42),
    power: readMetric(metricElements.power, 36),
    stability: readMetric(metricElements.stability, 48),
  };
  let selectedRole: PulseRole = 'architect';
  let pulse: PulseState | null = null;
  let animationFrame: number | null = null;
  let lastFrameTime: number | null = null;
  let width = 0;
  let height = 0;
  let isIntersecting = true;
  let isDestroyed = false;

  canvas.setAttribute('aria-hidden', 'true');
  canvas.tabIndex = -1;
  if (messageElement) {
    messageElement.setAttribute('aria-live', 'polite');
    messageElement.setAttribute('aria-atomic', 'true');
  }

  function canAnimate(): boolean {
    return !isDestroyed && isIntersecting && !document.hidden && !reducedMotion.matches;
  }

  function getLayout(): { cells: DrawCell[]; size: number } {
    const size = Math.max(11, Math.min((width * 0.78) / 7.7, (height * 0.76) / 6.8));
    const centerX = width / 2;
    const centerY = height / 2;
    return {
      size,
      cells: CITY_CELLS.map((cell) => ({
        ...cell,
        x: centerX + Math.sqrt(3) * size * (cell.q + cell.r / 2),
        y: centerY + 1.5 * size * cell.r,
      })),
    };
  }

  function pulseEnergy(distance: number, progress: number): number {
    const wave = progress * (MAX_HEX_DISTANCE + 1.1);
    const wavefront = clamp(1 - Math.abs(wave - distance) / 1.12, 0, 1);
    const trail = distance <= wave ? 0.18 * (1 - progress) : 0;
    return Math.max(wavefront, trail);
  }

  function draw(): void {
    if (width <= 0 || height <= 0) return;
    context.clearRect(0, 0, width, height);

    const profile = ROLE_PROFILES[selectedRole];
    const progress = pulse ? easeOutCubic(clamp(pulse.elapsed / PULSE_DURATION, 0, 1)) : 1;
    const activeProfile = pulse ? ROLE_PROFILES[pulse.role] : profile;
    const { cells, size } = getLayout();

    const background = context.createRadialGradient(
      width * 0.5,
      height * 0.48,
      0,
      width * 0.5,
      height * 0.48,
      Math.max(width, height) * 0.7,
    );
    background.addColorStop(0, 'rgba(19, 49, 65, 0.72)');
    background.addColorStop(0.48, 'rgba(8, 25, 38, 0.54)');
    background.addColorStop(1, 'rgba(3, 10, 17, 0.08)');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.save();
    for (const star of STAR_FIELD) {
      context.globalAlpha = star.alpha;
      context.fillStyle = '#c5f7ff';
      context.beginPath();
      context.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.lineCap = 'round';
    for (let firstIndex = 0; firstIndex < cells.length; firstIndex += 1) {
      const first = cells[firstIndex];
      if (!first) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < cells.length; secondIndex += 1) {
        const second = cells[secondIndex];
        if (!second || hexDistance(first, second) !== 1) continue;
        const midpointDistance = hexDistance(
          { q: (first.q + second.q) / 2, r: (first.r + second.r) / 2 },
          activeProfile.origin,
        );
        const energy = pulse ? pulseEnergy(midpointDistance, progress) : 0;
        context.strokeStyle = energy > 0
          ? colorWithAlpha(activeProfile.color, 0.26 + energy * 0.7)
          : 'rgba(114, 217, 233, 0.15)';
        context.lineWidth = 1 + energy * 2.4;
        context.shadowColor = activeProfile.color;
        context.shadowBlur = energy * 13;
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      }
    }
    context.restore();

    if (pulse) {
      const source = cells.find((cell) => cell.q === activeProfile.origin.q && cell.r === activeProfile.origin.r);
      if (source) {
        context.save();
        context.strokeStyle = colorWithAlpha(activeProfile.color, 0.6 * (1 - progress));
        context.lineWidth = 1.6;
        context.shadowColor = activeProfile.color;
        context.shadowBlur = 16;
        context.beginPath();
        context.arc(source.x, source.y, size * (0.45 + progress * 4.7), 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    }

    for (const cell of cells) {
      const distance = hexDistance(cell, activeProfile.origin);
      const energy = pulse ? pulseEnergy(distance, progress) : 0;
      const isCore = cell.q === 0 && cell.r === 0;
      const radius = size * (isCore ? 0.45 : 0.35) * (1 + energy * 0.18);

      context.save();
      context.shadowColor = activeProfile.color;
      context.shadowBlur = energy * 21;
      hexPath(context, cell.x, cell.y, radius);
      context.fillStyle = energy > 0
        ? colorWithAlpha(activeProfile.color, 0.13 + energy * 0.35)
        : isCore
          ? 'rgba(80, 205, 223, 0.2)'
          : 'rgba(9, 35, 48, 0.88)';
      context.fill();
      context.strokeStyle = energy > 0
        ? colorWithAlpha(activeProfile.color, 0.55 + energy * 0.4)
        : 'rgba(128, 230, 239, 0.32)';
      context.lineWidth = isCore ? 1.7 : 1.1;
      context.stroke();

      context.fillStyle = energy > 0 ? activeProfile.color : 'rgba(156, 235, 241, 0.62)';
      context.beginPath();
      context.arc(cell.x, cell.y, Math.max(1.25, size * 0.055) * (1 + energy), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    const selectedOrigin = cells.find(
      (cell) => cell.q === profile.origin.q && cell.r === profile.origin.r,
    );
    if (selectedOrigin) {
      context.save();
      context.strokeStyle = colorWithAlpha(profile.color, pulse ? 0.48 : 0.9);
      context.lineWidth = 2;
      context.shadowColor = profile.color;
      context.shadowBlur = 14;
      context.beginPath();
      context.arc(selectedOrigin.x, selectedOrigin.y, size * 0.52, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    drawMetricOrbit(cells, size);
  }

  function drawMetricOrbit(cells: DrawCell[], size: number): void {
    const center = cells.find((cell) => cell.q === 0 && cell.r === 0);
    if (!center) return;
    const colors: Record<MetricKey, string> = {
      food: '#b7f45b',
      power: '#ffc968',
      stability: '#62ddff',
    };
    const startAngle = Math.PI * 0.72;
    const arcLength = Math.PI * 1.56;

    context.save();
    context.lineCap = 'round';
    METRICS.forEach((metric, index) => {
      const radius = size * (3.72 + index * 0.2);
      context.strokeStyle = 'rgba(132, 217, 229, 0.08)';
      context.lineWidth = Math.max(1, size * 0.035);
      context.beginPath();
      context.arc(center.x, center.y, radius, startAngle, startAngle + arcLength);
      context.stroke();
      context.strokeStyle = colorWithAlpha(colors[metric], 0.6);
      context.beginPath();
      context.arc(
        center.x,
        center.y,
        radius,
        startAngle,
        startAngle + arcLength * (vitals[metric] / 100),
      );
      context.stroke();
    });
    context.restore();
  }

  function colorWithAlpha(color: string, alpha: number): string {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
  }

  function updateMetric(metric: MetricKey): void {
    const element = metricElements[metric];
    const value = vitals[metric];
    if (element) {
      if (element instanceof HTMLProgressElement) {
        element.max = 100;
        element.value = value;
      } else {
        element.textContent = `${value}%`;
      }
      element.setAttribute('aria-valuemin', '0');
      element.setAttribute('aria-valuemax', '100');
      element.setAttribute('aria-valuenow', String(value));
      if (!element.hasAttribute('aria-label')) {
        element.setAttribute('aria-label', `${metric}: ${value} percent`);
      }
    }

    const progress = progressElements[metric];
    if (progress) {
      progress.setAttribute('aria-valuenow', String(value));
      const bar = progress.querySelector<HTMLElement>('em');
      if (bar) bar.style.width = `${value}%`;
    }
  }

  function renderVitals(): void {
    for (const metric of METRICS) updateMetric(metric);
    const average = (vitals.food + vitals.power + vitals.stability) / METRICS.length;
    const state = average < 48 ? 'risk' : average < 70 ? 'holding' : 'stable';
    if (stateElement) {
      stateElement.textContent = state === 'risk' ? 'AT RISK' : state.toUpperCase();
      stateElement.dataset.state = state;
    }
  }

  function scheduleAnimation(): void {
    if (!pulse || animationFrame !== null || !canAnimate()) return;
    animationFrame = window.requestAnimationFrame(animate);
  }

  function animate(timestamp: number): void {
    animationFrame = null;
    if (!pulse || !canAnimate()) {
      lastFrameTime = null;
      return;
    }
    if (lastFrameTime === null) lastFrameTime = timestamp;
    pulse.elapsed += Math.min(50, Math.max(0, timestamp - lastFrameTime));
    lastFrameTime = timestamp;
    draw();
    if (pulse.elapsed >= PULSE_DURATION) {
      pulse = null;
      lastFrameTime = null;
      draw();
      return;
    }
    scheduleAnimation();
  }

  function pauseAnimation(): void {
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    lastFrameTime = null;
  }

  function applyRole(role: PulseRole): void {
    selectedRole = role;
    const profile = ROLE_PROFILES[role];
    vitals = {
      food: Math.round(clamp(vitals.food + profile.impact.food)),
      power: Math.round(clamp(vitals.power + profile.impact.power)),
      stability: Math.round(clamp(vitals.stability + profile.impact.stability)),
    };
    renderVitals();
    if (messageElement) {
      messageElement.textContent = `${profile.message} Food ${vitals.food}%, power ${vitals.power}%, stability ${vitals.stability}%.`;
    }
    for (const button of roleButtons) {
      const active = button.dataset.pulseRole === role;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    }
    root.style.setProperty('--pulse-accent', profile.color);
    root.dispatchEvent(
      new CustomEvent<{ role: PulseRole }>('afterhours:pulse-role', {
        bubbles: true,
        detail: { role },
      }),
    );

    pulse = reducedMotion.matches ? null : { elapsed: 0, role };
    lastFrameTime = null;
    draw();
    scheduleAnimation();
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.round(bounds.width);
    const nextHeight = Math.round(bounds.height);
    if (nextWidth <= 0 || nextHeight <= 0) return;
    const density = clamp(window.devicePixelRatio || 1, 1, 2);
    width = nextWidth;
    height = nextHeight;
    const pixelWidth = Math.round(width * density);
    const pixelHeight = Math.round(height * density);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(density, 0, 0, density, 0, 0);
    draw();
  }

  const buttonCleanups = roleButtons.map((button) => {
    const onClick = (): void => {
      const role = button.dataset.pulseRole;
      if (isPulseRole(role)) applyRole(role);
    };
    button.addEventListener('click', onClick);
    button.setAttribute('aria-pressed', String(button.dataset.pulseRole === selectedRole));
    return (): void => button.removeEventListener('click', onClick);
  });

  const onMotionPreferenceChange = (): void => {
    if (reducedMotion.matches) {
      pulse = null;
      pauseAnimation();
      draw();
    } else {
      scheduleAnimation();
    }
  };
  reducedMotion.addEventListener('change', onMotionPreferenceChange);

  const onVisibilityChange = (): void => {
    if (document.hidden) pauseAnimation();
    else scheduleAnimation();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const intersectionObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    isIntersecting = entry.isIntersecting;
    if (isIntersecting) {
      resize();
      scheduleAnimation();
    } else {
      pauseAnimation();
    }
  }, { rootMargin: '120px 0px' });
  intersectionObserver.observe(root);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resize, { passive: true });

  renderVitals();
  resize();

  return (): void => {
    isDestroyed = true;
    pauseAnimation();
    buttonCleanups.forEach((cleanup) => cleanup());
    reducedMotion.removeEventListener('change', onMotionPreferenceChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', resize);
    intersectionObserver.disconnect();
    resizeObserver.disconnect();
  };
}

/**
 * Activates every city-pulse module currently present in the document.
 * The returned function removes observers, animation frames, and event listeners.
 */
export function initCityPulse(): () => void {
  const cleanups = [...document.querySelectorAll<HTMLElement>('[data-city-pulse]')].map(mountCityPulse);
  return (): void => cleanups.forEach((cleanup) => cleanup());
}
