# AFTERHOURS — Midnight Moonshot qualification check

Audit date: 2026-09-06

Source: [Builder Handbook, section 8 — Evaluation](https://worldtour.spacetimedb.com/handbook#8)

Scope: the current `AFTERHOURS` repository, its Vercel marketing deployment, and linked Supabase project.

## Verdict

**Not fully qualified yet.** Current qualifier count: **0 confirmed pass, 6 partial, 4 fail**.

The marketing site, QR journey, waitlist capture, responsive UI, and Node/WebSocket shared-state prototype are valuable progress. However, the handbook requires the real-time logic to run in a **SpacetimeDB module on Maincloud created during the event window**. The current authoritative server is Node/Express/WebSockets with JSON persistence, so this is the primary blocker.

This is a repository-evidence audit, not an official judge score. Items that require event timestamps, real devices, public posts, email receipts, or submission-portal evidence remain unconfirmed until that evidence is saved.

## Ten qualifiers

| # | Handbook qualifier | Status | Current evidence | What is still required |
|---|---|---|---|---|
| 1 | Opens and runs on a phone | **Partial** | Responsive/touch rules exist in `src/styles.css`; a device matrix exists in `docs/QA.md`. | Record a completed test on at least one iPhone and one Android device, including screenshots and URLs. |
| 2 | Live URL opens and runs on the judges' device | **Partial** | The marketing/poster experience is deployed at `https://afterhours-night-shift.vercel.app/`. | Deploy the authoritative multiplayer game—not only the static marketing site—to a public URL and test it outside the development machine. |
| 3 | Module live on Maincloud, created inside the event window | **Fail** | No SpacetimeDB module or SDK is present. `README.md` describes SpacetimeDB only as a future replacement. | Create a fresh SpacetimeDB module during the allowed window, move canonical state and mutations into tables/reducers, publish it to Maincloud, and retain timestamp proof. |
| 4 | Repo created after 14:00 Saturday; nothing pushed after freeze | **Partial** | Local Git history begins at 2026-09-05 21:25 IST, after 14:00. | Preserve remote repository-creation evidence and the final remote push timestamp. Do not push after the announced freeze. |
| 5 | Demo video submitted and under 3 minutes | **Fail** | No tracked demo video or public demo-video URL. | Record, publish, and submit a sub-3-minute demo before the portal closes. |
| 6 | Public post links to every build | **Fail** | No launch-post URL or submission manifest is recorded. | Publish one post that links the game, Maincloud module/build evidence, repository if allowed, and demo. Save the URL here. |
| 7 | One-liner states who it is for and what it does | **Partial** | The repository explains the cooperative city-survival concept, but it does not name a precise ideal customer/player. | Put an ICP-specific one-liner on the product and in the launch post. Suggested draft: **“A live co-op crisis game for strategy-loving friend groups who want every decision—and every teammate—to matter.”** |
| 8 | Email comms live: signup causes an email to land | **Fail** | Supabase successfully stores waitlist registrations through `/api/signup`. There is no outbound email provider or receipt evidence. | Send an immediate welcome/confirmation email after a successful registration and retain a delivered-email test. |
| 9 | A stranger gets in within 30 seconds, with no password wall | **Partial** | The game join flow asks only for callsign and role; no account is required. | Test the public game URL with a first-time user, record the time, and show entry in under 30 seconds. |
| 10 | First-time-user onboarding shows what to do | **Partial** | A guided marketing journey now covers waitlist → A logo → Civic Core → QR. | Extend onboarding into the actual game until the player completes the first meaningful cooperative action; record an unaided test. |

## Scored parameters

Scores below are working estimates based only on repository evidence. Judges assign whole-number scores from 1–5.

| Parameter | Weight | Current evidence estimate | Why |
|---|---:|---:|---|
| Real-time | 35 | **2–3 / 5** | The Node server broadcasts canonical state over WebSockets, but the required SpacetimeDB tables, reducers, subscriptions, Maincloud module, two-tab proof, and 5+/10+ concurrency results are missing. |
| Problem solved | 35 | **2–3 / 5** | A cooperative survival loop exists, but no locked problem statement or recorded stranger test proves the core task can be completed unaided in under three minutes. |
| Positioning / ICP | 10 | **1 / 5** | The product idea is clear; the specific target player is not yet explicit on-product and in a public post. |
| First 500 users | 10 | **2 / 5** | QR posters and campaign-tagged Supabase intake form a credible channel, but there is no 500-user model or public outreach evidence. |
| Traction | 10 | **1 / 5** | No launch-post metrics, external engagements, or comparison with the median views of the previous ten posts is recorded. |

Unofficial evidence-only range: **36–50 / 100**, before any eligibility effect from the missing Maincloud module.

## Deployment and data check

- [x] Vercel project exists for the marketing/poster experience.
- [x] Supabase project `qmjwruonybpjoicakckx` is linked and reachable.
- [x] Migration `20260905142942_create_marketing_intake.sql` is applied remotely; the remote database reports no pending migrations.
- [x] `register_marketing_signup` and `capture_marketing_event` RPCs exist.
- [x] Waitlist data is stored in the private schema with RLS and without exposing the service-role key to the browser.
- [x] 38 waitlist registrations were present at audit time.
- [ ] Funnel telemetry currently contains zero recorded events; verify `/api/track` production delivery before using conversion metrics.
- [ ] Signup confirmation email is delivered.
- [ ] Authoritative game is deployed publicly.
- [ ] SpacetimeDB module is deployed on Maincloud.

## Priority plan to qualify

1. **Migrate the authoritative world to SpacetimeDB.** Model city state, players, roles, incidents, and actions as tables; implement mutations as reducers; drive the UI through subscriptions; publish to Maincloud inside the allowed window.
2. **Deploy the actual multiplayer game.** Give judges one public HTTPS URL and verify the same state changes in two tabs without refresh.
3. **Complete first-user onboarding.** Guide a stranger from entry to their first useful role action, then record the 30-second entry and sub-3-minute core-task tests.
4. **Add transactional email.** After Supabase records a signup, send a branded confirmation and verify delivery on a real inbox.
5. **Sharpen positioning.** Name the ICP on the landing page and in the one-liner; explain why campus QR posters reach that exact audience.
6. **Create submission evidence.** Record the under-three-minute demo, publish the build post, preserve module/repo timestamps, and collect physical-phone screenshots.
7. **Prove scale and traction.** Run two-tab, 5-user, and 10-user tests; record the first-500 outreach; compare launch-post performance with the median of the previous ten posts.

## Evidence to paste before submission

- Public game URL: `TBD`
- Maincloud module URL and creation timestamp: `TBD`
- Repository creation and final-push proof: `TBD`
- Demo video URL and duration: `TBD`
- Public launch post URL: `TBD`
- Delivered signup-email screenshot: `TBD`
- Phone test evidence: `TBD`
- Stranger entry time: `TBD`
- Unaided core-task completion time: `TBD`
- Two-tab and 10-user real-time test results: `TBD`
- ICP and first-500 plan: `TBD`
- Median views of last ten posts and launch-post metrics: `TBD`

## Final confirmation

**Current answer: no, AFTERHOURS does not yet match all Section 8 criteria.** It has a polished acquisition funnel and a promising real-time prototype, but it needs a fresh Maincloud module, a public authoritative game deployment, working signup email, and submission/market proof before it can be honestly marked ready.
