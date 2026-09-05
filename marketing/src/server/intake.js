const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAMPAIGN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PATH = /^\/[A-Za-z0-9._~%/-]*(?:#[A-Za-z0-9._~-]+)?$/;
const CALLSIGN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,23}$/u;
const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export const EVENT_NAMES = new Set([
  'landing_view',
  'story_opened',
  'how_to_play_opened',
  'cta_clicked',
  'game_open',
  'play_clicked',
  'signup_started',
  'signup_completed',
  'share_clicked',
  'poster_downloaded',
  'role_selected',
  'training_action',
  'poster_started',
  'poster_midpoint',
  'poster_completed',
]);

export const ROLES = new Set(['architect', 'cultivator', 'engineer', 'operator', 'medic']);
export const VIEWPORT_BUCKETS = new Set(['compact', 'regular', 'wide']);
export const CTA_PLACEMENTS = new Set(['header', 'hero', 'role', 'pulse', 'final', 'mobile']);
export const CTA_DESTINATIONS = new Set(['waitlist', 'game']);

const ROLE_DIMENSION_EVENTS = new Set([
  'play_clicked',
  'cta_clicked',
  'game_open',
  'signup_started',
  'signup_completed',
  'role_selected',
]);

export class IntakeError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'IntakeError';
    this.status = status;
    this.code = code;
  }
}

function fail(code = 'invalid_request') {
  throw new IntakeError(400, code);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, required) {
  if (!isRecord(value)) fail();
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key))) fail('unknown_field');
  if (required.some((key) => !Object.hasOwn(value, key))) fail('missing_field');
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) fail('invalid_id');
  return value.toLowerCase();
}

function campaign(value) {
  if (typeof value !== 'string') fail('invalid_campaign');
  const normalized = value.toLowerCase();
  if (!CAMPAIGN.test(normalized)) fail('invalid_campaign');
  return normalized;
}

function path(value) {
  if (typeof value !== 'string' || value.length > 160 || !PATH.test(value) || value.startsWith('//')) {
    fail('invalid_path');
  }
  return value;
}

function enumValue(value, values, code) {
  if (typeof value !== 'string' || !values.has(value)) fail(code);
  return value;
}

export function validateTrack(body) {
  exactKeys(
    body,
    new Set([
      'eventId',
      'sessionId',
      'campaign',
      'eventName',
      'path',
      'viewportBucket',
      'role',
      'action',
      'placement',
      'destination',
    ]),
    ['eventId', 'sessionId', 'campaign', 'eventName', 'path', 'viewportBucket'],
  );

  const eventName = enumValue(body.eventName, EVENT_NAMES, 'invalid_event');
  const role = body.role === undefined ? null : enumValue(body.role, ROLES, 'invalid_role');
  const action = body.action === undefined
    ? null
    : enumValue(body.action, ROLES, 'invalid_action');
  const placement = body.placement === undefined
    ? null
    : enumValue(body.placement, CTA_PLACEMENTS, 'invalid_placement');
  const destination = body.destination === undefined
    ? null
    : enumValue(body.destination, CTA_DESTINATIONS, 'invalid_destination');

  if (eventName === 'role_selected' && role === null) fail('missing_role');
  if (eventName === 'training_action' && action === null) fail('missing_action');
  if (role !== null && !ROLE_DIMENSION_EVENTS.has(eventName)) fail('unexpected_role');
  if (action !== null && eventName !== 'training_action') fail('unexpected_action');
  if (eventName === 'cta_clicked' && (placement === null || destination === null)) fail('missing_cta_dimension');
  if (eventName !== 'cta_clicked' && (placement !== null || destination !== null)) fail('unexpected_cta_dimension');

  return {
    eventId: uuid(body.eventId),
    sessionId: uuid(body.sessionId),
    campaign: campaign(body.campaign),
    eventName,
    path: path(body.path),
    viewportBucket: enumValue(body.viewportBucket, VIEWPORT_BUCKETS, 'invalid_viewport'),
    role,
    action,
    placement,
    destination,
  };
}

function email(value) {
  if (typeof value !== 'string') fail('invalid_email');
  const normalized = value.trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (
    normalized.length > 254
    || at < 1
    || at !== normalized.lastIndexOf('@')
    || at > 64
    || !EMAIL.test(normalized)
  ) {
    fail('invalid_email');
  }
  return normalized;
}

function callsign(value) {
  if (typeof value !== 'string') fail('invalid_callsign');
  const normalized = value.trim().normalize('NFC');
  if (normalized.length === 0) return null;
  if (!CALLSIGN.test(normalized)) fail('invalid_callsign');
  return normalized;
}

export function validateSignup(body) {
  exactKeys(
    body,
    new Set([
      'eventId',
      'sessionId',
      'campaign',
      'email',
      'callsign',
      'role',
      'consent',
      'website',
      'privacyVersion',
    ]),
    [
      'eventId',
      'sessionId',
      'campaign',
      'email',
      'callsign',
      'role',
      'consent',
      'website',
      'privacyVersion',
    ],
  );

  if (body.consent !== true) fail('consent_required');
  if (typeof body.website !== 'string' || body.website.length > 0) {
    throw new IntakeError(202, 'honeypot');
  }
  if (body.privacyVersion !== '2026-09-05') fail('invalid_privacy_version');

  return {
    eventId: uuid(body.eventId),
    // Deliberately validated but not persisted with the contact record.
    sessionId: uuid(body.sessionId),
    campaign: campaign(body.campaign),
    email: email(body.email),
    callsign: callsign(body.callsign),
    role: enumValue(body.role, ROLES, 'invalid_role'),
    privacyVersion: body.privacyVersion,
  };
}
