# AFTERHOURS marketing data

The landing page sends only allowlisted, pseudonymous funnel events through the
same-origin Vercel functions in `../api`. Contact details go to a separate table
that does not store the browser session ID, so an email address cannot be joined
back to a visitor's event trail.

## Apply the schema

From `marketing/`, authenticate and link the intended Supabase project, then
preview and apply the generated migration:

```powershell
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push --linked --dry-run
npx supabase@latest db push --linked
```

The migration keeps tables in the unexposed `private` schema, enables RLS as
defense in depth, and exposes only two `security invoker` RPCs to `service_role`.
Neither `anon` nor `authenticated` receives table or function access.

## Vercel secrets

Set these as server-side Vercel environment variables for Production and the
desired Preview environments:

- `SUPABASE_URL`: the project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the service-role key. Never prefix this with
  `VITE_` or otherwise expose it to browser code.
- `SITE_ORIGIN`: optional canonical HTTPS landing origin. Requests are also
  checked against the active Vercel host.

Do not add a public Supabase key to the landing: all writes intentionally pass
through `/api/track` and `/api/signup`.

## Analyst workflow

`private.marketing_funnel_daily` reports distinct landing, exploration, CTA,
game-open, and waitlist sessions plus landing-to-CTA and landing-to-signup rates.
Treat `landing_view` from a print campaign as the scan proxy.

Create one allowlisted campaign row before printing each placement, for example:

```sql
insert into private.marketing_campaigns (code, name, placement, creative)
values ('poster-library-v1', 'Library launch poster', 'Central library', 'City awake');
```

Use that exact code as the poster generator's `--campaign` value. This keeps
library, cafe, campus, and creative variants comparable without storing a
persistent visitor identity.
