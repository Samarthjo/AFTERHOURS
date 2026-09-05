import assert from 'node:assert/strict';
import { IntakeError, validateSignup, validateTrack } from '../src/server/intake.js';

const ids = {
  eventId: '10f57ed1-14a8-4d04-a77d-51376d67df53',
  sessionId: '62822d65-821f-4ea8-8776-3a1d682675cb',
};

const baseEvent = {
  ...ids,
  campaign: 'poster-launch-v1',
  path: '/#roles',
  viewportBucket: 'compact',
};

assert.equal(validateTrack({ ...baseEvent, eventName: 'landing_view' }).eventName, 'landing_view');
assert.equal(validateTrack({ ...baseEvent, path: '/poster', eventName: 'poster_started' }).eventName, 'poster_started');
assert.equal(validateTrack({ ...baseEvent, path: '/poster', eventName: 'poster_midpoint' }).eventName, 'poster_midpoint');
assert.equal(validateTrack({ ...baseEvent, path: '/poster', eventName: 'poster_completed' }).eventName, 'poster_completed');
assert.deepEqual(
  validateTrack({
    ...baseEvent,
    eventName: 'cta_clicked',
    role: 'operator',
    placement: 'mobile',
    destination: 'waitlist',
  }).placement,
  'mobile',
);
assert.equal(
  validateTrack({ ...baseEvent, eventName: 'training_action', action: 'cultivator' }).action,
  'cultivator',
);
assert.equal(
  validateSignup({
    ...ids,
    campaign: 'poster-launch-v1',
    email: '  CITIZEN@example.com ',
    callsign: '',
    role: 'medic',
    consent: true,
    website: '',
    privacyVersion: '2026-09-05',
  }).callsign,
  null,
);

for (const payload of [
  { ...baseEvent, eventName: 'cta_clicked', role: 'medic' },
  { ...baseEvent, eventName: 'landing_view', placement: 'hero' },
  { ...baseEvent, eventName: 'training_action', action: 'feed' },
  { ...baseEvent, eventName: 'landing_view', email: 'must-not-pass@example.com' },
]) {
  assert.throws(() => validateTrack(payload), IntakeError);
}

assert.throws(
  () => validateSignup({
    ...ids,
    campaign: 'poster-launch-v1',
    email: 'citizen@example.com',
    callsign: '',
    role: 'medic',
    consent: false,
    website: '',
    privacyVersion: '2026-09-05',
  }),
  IntakeError,
);

console.log('Marketing intake validation passed.');
