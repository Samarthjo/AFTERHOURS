import { initCityPulse } from './city-pulse';
import { GuidedTour, readGuideStage, writeGuideStage } from './guided-tour';

type CivicRole = 'architect' | 'cultivator' | 'engineer' | 'operator' | 'medic';
type CtaPlacement = 'header' | 'hero' | 'role' | 'pulse' | 'final' | 'mobile';
type LandingEvent =
  | 'landing_view'
  | 'story_opened'
  | 'how_to_play_opened'
  | 'cta_clicked'
  | 'game_open'
  | 'play_clicked'
  | 'signup_started'
  | 'signup_completed'
  | 'share_clicked'
  | 'poster_downloaded'
  | 'role_selected'
  | 'training_action';

interface RoleProfile {
  icon: string;
  kicker: string;
  title: string;
  ctaTitle: string;
  copy: string;
  quote: string;
  accent: string;
}

interface TrackOptions {
  role?: CivicRole;
  action?: CivicRole;
  placement?: CtaPlacement;
  destination?: 'waitlist' | 'game';
}

const roles: Record<CivicRole, RoleProfile> = {
  architect: {
    icon: '⬡',
    kicker: 'MATERIALS / INFRASTRUCTURE',
    title: 'Architect',
    ctaTitle: 'Architect',
    copy: 'Make room before the city outgrows itself. Turn materials into shelters and infrastructure.',
    quote: '“Measure twice. Panic once.”',
    accent: '#59f59a',
  },
  cultivator: {
    icon: '◆',
    kicker: 'WATER / FOOD',
    title: 'Cultivator',
    ctaTitle: 'Cultivator',
    copy: 'Keep the pantry ahead of the population. Grow food, stretch water, and make scarcity negotiable.',
    quote: '“Hope is good. Irrigation is better.”',
    accent: '#b7f45b',
  },
  engineer: {
    icon: '✦',
    kicker: 'COMPONENTS / MAINTENANCE',
    title: 'Systems Engineer',
    ctaTitle: 'Engineer',
    copy: 'Hear the city before it breaks. Repair failing systems and turn spare parts into breathing room.',
    quote: '“That noise was probably already there.”',
    accent: '#62ddff',
  },
  operator: {
    icon: 'ϟ',
    kicker: 'FUEL / POWER',
    title: 'Grid Operator',
    ctaTitle: 'Operator',
    copy: 'Route scarce power where it matters most. Keep the lights on without cooking the grid.',
    quote: '“Everything is fine at 60 hertz.”',
    accent: '#ffc968',
  },
  medic: {
    icon: '●',
    kicker: 'MEDICINE / STABILITY',
    title: 'Civic Medic',
    ctaTitle: 'Medic',
    copy: 'Treat more than injuries. Spend medicine and care to stop a hard night becoming a civic collapse.',
    quote: '“Please form one orderly existential crisis.”',
    accent: '#ff6c7a',
  },
};

const campaignPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;
const query = new URLSearchParams(window.location.search);
const configuredCampaign = (import.meta.env.VITE_CAMPAIGN_CODE || 'poster-launch-v1').toLowerCase();
const queryCampaign = (query.get('c') || '').toLowerCase();
const campaign = rememberCampaign(campaignPattern.test(queryCampaign) ? queryCampaign : configuredCampaign);
const sessionId = getSessionId();
const gameUrl = normaliseGameUrl(import.meta.env.VITE_GAME_URL);
let selectedRole: CivicRole = 'architect';

document.documentElement.classList.add('js');
document.documentElement.style.setProperty('--role-accent', roles[selectedRole].accent);
const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
if (connection?.saveData) document.documentElement.classList.add('reduce-data');

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

function rememberCampaign(candidate: string): string {
  const key = 'afterhours.campaign.v1';
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && campaignPattern.test(existing)) return existing;
    const safe = campaignPattern.test(candidate) ? candidate : 'poster-launch-v1';
    window.sessionStorage.setItem(key, safe);
    return safe;
  } catch {
    return campaignPattern.test(candidate) ? candidate : 'poster-launch-v1';
  }
}

function normaliseGameUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url : null;
  } catch {
    return null;
  }
}

function viewportBucket(): 'compact' | 'regular' | 'wide' {
  if (window.innerWidth < 640) return 'compact';
  if (window.innerWidth < 1180) return 'regular';
  return 'wide';
}

function safePath(): string {
  const path = `${window.location.pathname}${window.location.hash}`;
  return path.length <= 160 ? path : window.location.pathname.slice(0, 160);
}

async function track(eventName: LandingEvent, options: TrackOptions = {}): Promise<void> {
  const payload = {
    eventId: crypto.randomUUID(),
    sessionId,
    campaign,
    eventName,
    path: safePath(),
    viewportBucket: viewportBucket(),
    ...options,
  };

  try {
    await fetch('/api/track', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Marketing telemetry must never block the experience.
  }
}

function gameDestination(): string | null {
  if (!gameUrl) return null;
  const destination = new URL(gameUrl);
  destination.searchParams.set('c', campaign);
  const gameRoles: Record<CivicRole, string> = {
    architect: 'builder',
    cultivator: 'grower',
    engineer: 'engineer',
    operator: 'operator',
    medic: 'medic',
  };
  destination.searchParams.set('role', gameRoles[selectedRole]);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    const value = query.get(key);
    if (value) destination.searchParams.set(key, value.slice(0, 100));
  }
  return destination.toString();
}

function scrollToRoster(): void {
  const avoidAnimatedScroll = window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse), (max-width: 640px)').matches;
  document.querySelector<HTMLElement>('#join')?.scrollIntoView({
    behavior: avoidAnimatedScroll ? 'auto' : 'smooth',
    block: 'start',
  });
  if (window.matchMedia('(pointer: fine)').matches) {
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>('input[name="email"]')?.focus(),
      avoidAnimatedScroll ? 0 : 220,
    );
  }
}

function isPlacement(value: string | undefined): value is CtaPlacement {
  return Boolean(value && ['header', 'hero', 'role', 'pulse', 'final', 'mobile'].includes(value));
}

for (const playLink of document.querySelectorAll<HTMLAnchorElement>('[data-play]')) {
  playLink.addEventListener('click', (event) => {
    const destination = gameDestination();
    const placement = isPlacement(playLink.dataset.placement) ? playLink.dataset.placement : 'hero';
    void track('cta_clicked', {
      role: selectedRole,
      placement,
      destination: destination ? 'game' : 'waitlist',
    });
    if (destination) {
      event.preventDefault();
      void track('game_open', { role: selectedRole });
      window.setTimeout(() => window.location.assign(destination), 90);
      return;
    }

    event.preventDefault();
    scrollToRoster();
  });
}

for (const rosterLink of document.querySelectorAll<HTMLAnchorElement>('[data-focus-waitlist]')) {
  rosterLink.addEventListener('click', (event) => {
    event.preventDefault();
    scrollToRoster();
  });
}

const roleTabs = [...document.querySelectorAll<HTMLButtonElement>('.role-tab')];
const roleDetail = document.querySelector<HTMLElement>('[data-role-detail]');
const roleSelect = document.querySelector<HTMLSelectElement>('[data-role-select]');

function isRole(value: string | undefined): value is CivicRole {
  return Boolean(value && value in roles);
}

function replaceActionText(element: HTMLElement, label: string): void {
  const directText = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  if (directText) directText.textContent = `${label} `;
}

function updateRoleConversionCopy(role: CivicRole): void {
  const profile = roles[role];
  const defaultLabel = gameUrl ? `Play as ${profile.ctaTitle}` : `Join as ${profile.ctaTitle}`;
  document.querySelectorAll<HTMLElement>('[data-play]').forEach((element) => {
    const placement = element.dataset.placement;
    const label = placement === 'role'
      ? (gameUrl ? `Play as ${profile.ctaTitle}` : `Join ${profile.ctaTitle} waitlist`)
      : defaultLabel;
    replaceActionText(element, label);
  });
  const selectedShift = document.querySelector<HTMLElement>('[data-selected-shift]');
  const shiftNumber = (Object.keys(roles) as CivicRole[]).indexOf(role) + 1;
  if (selectedShift) selectedShift.innerHTML = `<span>${String(shiftNumber).padStart(2, '0')}</span> ${profile.title} shift selected`;
  const submitLabel = document.querySelector<HTMLElement>('[data-submit-label]');
  if (submitLabel) submitLabel.textContent = `Join the ${profile.ctaTitle} waitlist`;
}

function selectRole(role: CivicRole, shouldTrack = true): void {
  selectedRole = role;
  const profile = roles[role];
  document.documentElement.style.setProperty('--role-accent', profile.accent);

  for (const tab of roleTabs) {
    const active = tab.dataset.role === role;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }

  const icon = roleDetail?.querySelector<HTMLElement>('[data-role-icon]');
  const kicker = roleDetail?.querySelector<HTMLElement>('[data-role-kicker]');
  const title = roleDetail?.querySelector<HTMLElement>('[data-role-title]');
  const copy = roleDetail?.querySelector<HTMLElement>('[data-role-copy]');
  const quote = roleDetail?.querySelector<HTMLElement>('[data-role-quote]');
  if (icon) icon.textContent = profile.icon;
  if (kicker) kicker.textContent = profile.kicker;
  if (title) title.textContent = profile.title;
  if (copy) copy.textContent = profile.copy;
  if (quote) quote.textContent = profile.quote;
  roleDetail?.setAttribute('aria-labelledby', `tab-${role}`);
  if (roleSelect) roleSelect.value = role;
  updateRoleConversionCopy(role);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    roleDetail?.animate(
      [{ opacity: 0.45, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
  if (shouldTrack) void track('role_selected', { role });
}

roleTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    if (isRole(tab.dataset.role)) selectRole(tab.dataset.role);
  });
  tab.addEventListener('keydown', (event) => {
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % roleTabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + roleTabs.length) % roleTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = roleTabs.length - 1;
    else return;
    event.preventDefault();
    const nextRole = roleTabs[next]?.dataset.role;
    if (isRole(nextRole)) {
      selectRole(nextRole);
      roleTabs[next]?.focus();
    }
  });
});

roleSelect?.addEventListener('change', () => {
  if (isRole(roleSelect.value)) selectRole(roleSelect.value);
});

const initialRole = query.get('role');
selectRole(isRole(initialRole ?? undefined) ? initialRole as CivicRole : selectedRole, false);

document.addEventListener('afterhours:pulse-role', (event) => {
  const detail = (event as CustomEvent<{ role?: string }>).detail;
  if (!isRole(detail?.role)) return;
  void track('training_action', { action: detail.role });
  selectRole(detail.role);
});

const form = document.querySelector<HTMLFormElement>('[data-signup-form]');
const formStatus = document.querySelector<HTMLElement>('[data-form-status]');
const signupProgress = document.querySelector<HTMLElement>('[data-signup-progress]');
const signupProgressLabel = document.querySelector<HTMLElement>('[data-signup-progress-label]');
const landingBrand = document.querySelector<HTMLAnchorElement>('.site-header .brand');
const waitlistSubmit = form?.querySelector<HTMLButtonElement>('button[type="submit"]') || null;
const landingGuide = new GuidedTour(() => writeGuideStage('dismissed'));
let signupStarted = false;

function showLandingGuide(): void {
  const currentStage = readGuideStage();
  if (currentStage === 'complete' || currentStage === 'dismissed') {
    landingGuide.hide();
    return;
  }

  if (currentStage === 'logo' || currentStage === 'core' || currentStage === 'qr') {
    if (!landingBrand) return;
    writeGuideStage('logo');
    landingGuide.show({
      target: landingBrand,
      step: 'STEP 2 OF 4',
      title: 'Enter the city',
      body: 'Your shift is reserved. Tap the A signal above to enter the city poster.',
      placement: 'below',
      scrollIntoView: false,
    });
    return;
  }

  if (!waitlistSubmit) return;
  writeGuideStage('waitlist');
  landingGuide.show({
    target: waitlistSubmit,
    step: 'STEP 1 OF 4',
    title: 'Reserve your shift',
    body: 'Add your email, confirm consent, then tap “Join the Architect waitlist.”',
    placement: 'right',
  });
}

landingBrand?.addEventListener('click', () => {
  if (readGuideStage() !== 'logo') return;
  writeGuideStage('core');
  landingGuide.hide();
});

function lockRoleChangingControls(): () => void {
  const controls: Array<HTMLButtonElement | HTMLSelectElement> = [
    ...roleTabs,
    ...document.querySelectorAll<HTMLButtonElement>('[data-pulse-role]'),
  ];
  if (roleSelect) controls.push(roleSelect);

  const previousStates = controls.map((control) => ({ control, disabled: control.disabled }));
  controls.forEach((control) => { control.disabled = true; });

  return () => {
    previousStates.forEach(({ control, disabled }) => { control.disabled = disabled; });
  };
}

function updateSignupProgress(): void {
  if (!form) return;
  const email = form.elements.namedItem('email');
  const consent = form.elements.namedItem('consent');
  const emailComplete = email instanceof HTMLInputElement && email.value.length > 0 && email.validity.valid;
  const consentComplete = consent instanceof HTMLInputElement && consent.checked;
  const completed = Number(emailComplete) + Number(consentComplete);
  if (signupProgress) signupProgress.style.width = `${completed * 50}%`;
  if (signupProgressLabel) signupProgressLabel.textContent = `${completed} / 2`;
}

form?.addEventListener('input', (event) => {
  const field = event.target;
  if (field instanceof HTMLInputElement && field.validity.valid) field.removeAttribute('aria-invalid');
  if (form.classList.contains('has-error')) {
    form.classList.remove('has-error');
    if (formStatus) formStatus.textContent = '';
  }
  updateSignupProgress();
});

form?.addEventListener('focusin', () => {
  if (signupStarted) return;
  signupStarted = true;
  void track('signup_started', { role: selectedRole });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.checkValidity()) {
    const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement>(':invalid');
    invalid?.setAttribute('aria-invalid', 'true');
    form.classList.add('has-error');
    if (formStatus) formStatus.textContent = invalid?.name === 'consent'
      ? 'Confirm you want playtest updates to reserve this shift.'
      : 'Enter a valid email so the city can reach you.';
    invalid?.focus();
    form.reportValidity();
    return;
  }

  const data = new FormData(form);
  if (String(data.get('website') || '').trim()) return;
  const requestedRole = String(data.get('role') || '');
  const submittedRole: CivicRole = isRole(requestedRole) ? requestedRole : selectedRole;
  const restoreRoleChangingControls = lockRoleChangingControls();
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  form.classList.add('is-loading');
  form.setAttribute('aria-busy', 'true');
  form.classList.remove('has-error', 'is-success');
  if (formStatus) formStatus.textContent = 'Connecting your shift to the civic roster…';

  try {
    const response = await fetch('/api/signup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        sessionId,
        campaign,
        email: String(data.get('email') || '').trim().toLowerCase(),
        callsign: String(data.get('callsign') || '').trim(),
        role: submittedRole,
        consent: data.get('consent') === 'on',
        website: '',
        privacyVersion: '2026-09-05',
      }),
    });
    if (!response.ok) throw new Error('signup unavailable');
    form.classList.add('is-success');
    if (formStatus) formStatus.textContent = 'You’re on the roster. Watch your inbox for the city signal.';
    const receipt = form.querySelector<HTMLElement>('[data-signup-receipt]');
    const receiptCallsign = form.querySelector<HTMLElement>('[data-receipt-callsign]');
    const receiptRole = form.querySelector<HTMLElement>('[data-receipt-role]');
    if (receiptCallsign) receiptCallsign.textContent = String(data.get('callsign') || '').trim() || 'NIGHT CITIZEN';
    if (receiptRole) receiptRole.textContent = `${roles[submittedRole].title.toUpperCase()} // FOUNDING ROSTER`;
    if (receipt) {
      receipt.hidden = false;
      receipt.focus();
    }
    form.reset();
    form.querySelectorAll('[aria-invalid="true"]').forEach((element) => element.removeAttribute('aria-invalid'));
    if (roleSelect) roleSelect.value = selectedRole;
    updateSignupProgress();
    void track('signup_completed', { role: submittedRole });
    writeGuideStage('logo');
    window.setTimeout(showLandingGuide, 120);
  } catch {
    form.classList.add('has-error');
    if (formStatus) formStatus.textContent = 'The roster link is offline right now. Please try again in a moment.';
  } finally {
    restoreRoleChangingControls();
    form.classList.remove('is-loading');
    form.removeAttribute('aria-busy');
    if (submit) submit.disabled = false;
  }
});

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  },
  { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
);
document.querySelectorAll<HTMLElement>('.reveal').forEach((element) => observer.observe(element));

const header = document.querySelector<HTMLElement>('[data-header]');
let howTracked = false;
const howSection = document.querySelector<HTMLElement>('#how');
const sectionObserver = new IntersectionObserver((entries) => {
  if (!howTracked && entries.some((entry) => entry.isIntersecting)) {
    howTracked = true;
    void track('how_to_play_opened');
  }
}, { threshold: 0.35 });
if (howSection) sectionObserver.observe(howSection);

let ticking = false;
function updateScrollEffects(): void {
  const scrollY = window.scrollY;
  header?.classList.toggle('is-scrolled', scrollY > 30);
  document.documentElement.style.setProperty('--scroll-shift', `${Math.min(scrollY * 0.08, 52)}px`);
  const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  document.documentElement.style.setProperty('--page-progress', String(Math.min(1, scrollY / scrollable)));
  ticking = false;
}
window.addEventListener('scroll', () => {
  if (!ticking) {
    requestAnimationFrame(updateScrollEffects);
    ticking = true;
  }
}, { passive: true });
updateScrollEffects();
window.setTimeout(showLandingGuide, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.setTimeout(showLandingGuide, 80);
});

const hero = document.querySelector<HTMLElement>('.hero');
const joinSection = document.querySelector<HTMLElement>('#join');
const pulsePayoff = document.querySelector<HTMLElement>('.pulse-payoff');
const mobileCtaVisibility = new Map<Element, boolean>();
const mobileCtaObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) mobileCtaVisibility.set(entry.target, entry.isIntersecting);
  document.body.classList.toggle('suppress-mobile-cta', [...mobileCtaVisibility.values()].some(Boolean));
}, { threshold: 0.08 });
if (hero) mobileCtaObserver.observe(hero);
if (joinSection) mobileCtaObserver.observe(joinSection);
if (pulsePayoff) mobileCtaObserver.observe(pulsePayoff);

hero?.addEventListener('pointermove', (event) => {
  if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;
  const rect = hero.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  hero.style.setProperty('--pointer-x', x.toFixed(3));
  hero.style.setProperty('--pointer-y', y.toFixed(3));
});

document.querySelectorAll<HTMLElement>('[data-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

const destroyCityPulse = initCityPulse();
window.addEventListener('pagehide', destroyCityPulse, { once: true });
updateSignupProgress();
void track('landing_view');
