# AFTERHOURS print poster source

The poster generator produces an editable A3 SVG and a matching campaign manifest. It keeps the QR payload, printed dimensions, tracking parameters, and checksum together so every physical batch can be audited.

## Generate a custom-domain poster

From `marketing/`:

```powershell
npm run poster -- --url https://play.afterhours.example/ --campaign campus-north-a3
```

## Generate from a stable Vercel production alias

Vercel preview URLs are intentionally rejected. A `*.vercel.app` URL also requires an explicit assertion of the stable production alias:

```powershell
npm run poster -- --url https://afterhours.example-team.vercel.app/ --campaign poster-launch-v1 --vercel-production-alias afterhours.example-team.vercel.app
```

By default the command writes `poster/generated/<campaign>.svg` and `poster/generated/<campaign>.json`. Use `--out` to choose a basename. The same arguments always produce byte-identical files.

## Print checklist

- Render/export at A3 portrait, 297 × 420 mm, with no scaling.
- Keep the SVG as the editable source; create the distribution PDF from it.
- Never recolor, crop, distort, or cover the white QR plate.
- Print one proof and test it with at least two phones, in both bright and dim light.
- Verify the browser address contains `utm_source=print`, `utm_medium=qr`, and the expected `qr_id`.
- Verify `c` and `qr_id` both equal the allowlisted Supabase campaign code.
- Retire or redirect a campaign URL before destroying the associated manifest.

The QR uses error correction level H and a four-module quiet zone. The JSON manifest includes the exact encoded URL and its SHA-256 checksum.
