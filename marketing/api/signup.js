import { acceptIntake } from '../src/server/http.js';
import { validateSignup } from '../src/server/intake.js';

export default async function signup(request, response) {
  await acceptIntake(request, response, {
    validate: validateSignup,
    rpc: 'register_marketing_signup',
    parameters: (signup) => ({
      p_signup_event_id: signup.eventId,
      p_campaign: signup.campaign,
      p_email: signup.email,
      p_callsign: signup.callsign,
      p_preferred_role: signup.role,
      p_privacy_version: signup.privacyVersion,
    }),
  });
}
