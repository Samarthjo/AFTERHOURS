# AFTERHOURS marketing site

QR-first landing page, interactive city-signal poster, waitlist intake, campaign analytics, and an A3 poster generator for the AFTERHOURS playtest.

## Local development

Requires a current Node.js release. From `marketing/`:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

`npm run dev` serves the landing page at `/` and the interactive poster at `/poster.html`. Use `npx vercel@latest dev` when testing the `/api/track` and `/api/signup` functions locally. Fill `.env.local` with your own development values; it is ignored by Git.

## Test and build

```powershell
npm test
npm run build
npm run preview
```

The test suite covers the server intake validators. The build also runs strict TypeScript checking before creating both `dist/index.html` and `dist/poster.html`.

## Generate a tracked poster

Create the matching Supabase campaign first, then generate the print source with the same campaign code:

```powershell
npm run poster -- --url https://YOUR_PRODUCTION_DOMAIN/ --campaign campus-north-a3
```

This writes a deterministic A3 SVG and JSON manifest under `poster/generated/`. For a stable `*.vercel.app` production alias, also pass `--vercel-production-alias YOUR_ALIAS.vercel.app`; preview URLs are intentionally rejected. See `poster/README.md` for QR and print checks.

### Direct poster image

The verified A3 proof is published as a standalone image at `/afterhours-poster.png` (currently `https://afterhours-night-shift.vercel.app/afterhours-poster.png`). The image URL remains available for downloading and printing, but it is not the destination of the interactive display's morphing QR.

The compact creative route `/p/1` temporarily redirects to `/poster?shift=dusk&grid=stable&pressure=critical&role=architect`. This keeps the QR payload short while opening the exact dusk-shift Architect poster state. A temporary redirect is intentional so the campaign destination can be changed later without clients caching an obsolete target.

The QR visible inside that PNG remains encoded with the campaign-tagged landing URL recorded in `poster/generated/afterhours-poster-a3-v1.json`. It opens the landing root with `c`, UTM, and `qr_id` parameters; it does not loop back to the PNG or open `/poster.html`. Publishing the image at a new route does not change its embedded QR payload.

## Supabase setup

The browser never receives a Supabase key. Same-origin Vercel functions validate allowlisted payloads and use the service role only on the server.

```powershell
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push --linked --dry-run
npx supabase@latest db push --linked
```

The migration in `supabase/migrations/` creates locked-down tables in the `private` schema, two service-role-only RPCs, and `private.marketing_funnel_daily`. Add one campaign row before distributing each QR placement:

```sql
insert into private.marketing_campaigns (code, name, placement, creative)
values ('campus-north-a3', 'Campus north poster', 'North entrance', 'City awake');
```

## Vercel configuration and deploy

Set these in Vercel for Production and any Preview environment that should accept submissions:

- `SUPABASE_URL` — Supabase project URL; server only.
- `SUPABASE_SERVICE_ROLE_KEY` — service-role secret; server only and never prefixed with `VITE_`.
- `SITE_ORIGIN` — optional canonical HTTPS landing origin.
- `VITE_GAME_URL` — optional public game URL.
- `VITE_CAMPAIGN_CODE` — fallback campaign, normally `poster-launch-v1`.

Use the Vercel dashboard or prompted CLI commands so secrets do not enter shell history or tracked files, then deploy from `marketing/`:

```powershell
npx vercel@latest link
npx vercel@latest --prod
```

Generate and print the QR poster only after the production alias or custom domain is stable.

## Analytics notes

- `/api/track` stores allowlisted, pseudonymous funnel events; `/api/signup` stores consented contact details separately.
- Email addresses are deliberately not joined to browser session IDs.
- Use `landing_view` as the scan proxy for print QRs that open the landing page, and compare campaigns in `private.marketing_funnel_daily`.
- The interactive display emits `poster_started`, `poster_midpoint`, and `poster_completed`. Its morphing QR opens `/p/1`, whose redirect can be counted in Vercel access logs; the destination poster page can also run the Supabase browser tracker and preserves the requested dusk/stable/critical/Architect state in its query string.
- The core funnel is landing view → role/training exploration → CTA → game open or waitlist completion.
- Give every poster location or creative a unique allowlisted campaign code, and use that same code for `--campaign` so the manifest, QR URL, and database agree.

```sql
select *
from private.marketing_funnel_daily
order by day desc, campaign;
```
