import { acceptIntake } from '../src/server/http.js';
import { validateTrack } from '../src/server/intake.js';

export default async function track(request, response) {
  await acceptIntake(request, response, {
    validate: validateTrack,
    rpc: 'capture_marketing_event',
    parameters: (event) => ({
      p_event_id: event.eventId,
      p_session_id: event.sessionId,
      p_campaign: event.campaign,
      p_event_name: event.eventName,
      p_path: event.path,
      p_viewport_bucket: event.viewportBucket,
      p_role: event.role,
      p_action: event.action,
      p_placement: event.placement,
      p_destination: event.destination,
    }),
  });
}
