#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const PAGE = Object.freeze({ widthMm: 297, heightMm: 420, format: "A3 portrait" });
const QR = Object.freeze({ errorCorrectionLevel: "H", quietZoneModules: 4, sizeMm: 64 });
const DEFAULT_CAMPAIGN = "afterhours_launch";

function usage() {
  return `AFTERHOURS A3 poster generator

Usage:
  npm run poster -- --url <production-url> --campaign <campaign-code> [options]

Required:
  --url <url>            Canonical HTTPS landing-page URL
  --campaign <code>      Print campaign / QR identifier (3-48 chars)

Options:
  --utm-campaign <code>  UTM campaign (default: afterhours_launch)
  --out <path>           Output basename or directory
                         (default: poster/generated/<campaign>)
  --vercel-production-alias <hostname>
                         Required for a *.vercel.app URL. Must be the stable
                         production alias, not a deployment or branch URL.
  --help                 Show this message

Outputs:
  <basename>.svg         Editable, print-sized A3 artwork with embedded QR
  <basename>.json        Deterministic production manifest and QR payload
`;
}

function parseArgs(argv) {
  const args = {};
  const valueFlags = new Set([
    "url",
    "campaign",
    "utm-campaign",
    "out",
    "vercel-production-alias",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const [rawName, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    if (!valueFlags.has(rawName)) {
      throw new Error(`Unknown option: --${rawName}`);
    }
    const value = inlineValue ?? argv[index + 1];
    if (!value || (!inlineValue && value.startsWith("--"))) {
      throw new Error(`Missing value for --${rawName}`);
    }
    args[rawName] = value;
    if (inlineValue === undefined) index += 1;
  }

  return args;
}

function validateCampaignCode(value) {
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(value ?? "")) {
    throw new Error("--campaign must be 3-48 lowercase letters, numbers, or hyphens.");
  }
  return value;
}

function validateUtmCode(value) {
  if (!/^[a-z0-9][a-z0-9_-]{2,47}$/.test(value ?? "")) {
    throw new Error("--utm-campaign must be 3-48 lowercase letters, numbers, underscores, or hyphens.");
  }
  return value;
}

function looksLikeVercelPreview(hostname) {
  const label = hostname.replace(/\.vercel\.app$/i, "");
  return (
    /(?:^|-)git-(?:[^-]+-)+/i.test(label) ||
    /(?:^|-)(?:preview|pr-?\d+)(?:-|$)/i.test(label) ||
    /-[a-z0-9]{9,}-(?:[a-z0-9-]+)$/i.test(label)
  );
}

function canonicalProductionUrl(rawUrl, declaredVercelAlias) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("--url must be an absolute production URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Poster QR URLs must use HTTPS; localhost and HTTP URLs are rejected.");
  }
  if (
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(url.hostname) ||
    /\.(?:localhost|local|test|invalid)$/i.test(url.hostname)
  ) {
    throw new Error("--url must be a public production origin without credentials, port, or fragment.");
  }

  url.hostname = url.hostname.toLowerCase();
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (!url.pathname.endsWith("/")) url.pathname += "/";

  if (url.hostname.endsWith(".vercel.app")) {
    if (looksLikeVercelPreview(url.hostname)) {
      throw new Error("Vercel branch and deployment preview URLs cannot be printed. Use the stable production alias.");
    }
    if (!declaredVercelAlias) {
      throw new Error(
        "For a *.vercel.app URL, pass --vercel-production-alias with the exact stable production hostname.",
      );
    }
    const alias = declaredVercelAlias.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (alias !== url.hostname || !alias.endsWith(".vercel.app") || looksLikeVercelPreview(alias)) {
      throw new Error("--vercel-production-alias must exactly match a non-preview *.vercel.app hostname.");
    }
  } else if (declaredVercelAlias) {
    throw new Error("--vercel-production-alias is only valid when --url uses a *.vercel.app hostname.");
  }

  return url;
}

function buildTrackingUrl(baseUrl, campaign, utmCampaign) {
  const url = new URL(baseUrl);
  url.searchParams.set("c", campaign);
  url.searchParams.set("utm_source", "print");
  url.searchParams.set("utm_medium", "qr");
  url.searchParams.set("utm_campaign", utmCampaign);
  url.searchParams.set("utm_content", "city_awake");
  url.searchParams.set("qr_id", campaign);
  return url;
}

function resolveOutput(rawOut, campaign) {
  const defaultBase = path.resolve("poster", "generated", campaign);
  if (!rawOut) return defaultBase;

  const resolved = path.resolve(rawOut);
  if (path.extname(resolved).toLowerCase() === ".svg") return resolved.slice(0, -4);
  if (path.extname(resolved).toLowerCase() === ".json") return resolved.slice(0, -5);
  if (/[\\\/]$/.test(rawOut)) return path.join(resolved, campaign);
  return resolved;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cdata(value) {
  return String(value).replaceAll("]]>", "]]]]><![CDATA[>");
}

function number(value) {
  return Number(value.toFixed(4));
}

function compactLabel(value, maximumCharacters) {
  const normalized = String(value).toUpperCase();
  return normalized.length <= maximumCharacters
    ? normalized
    : `${normalized.slice(0, maximumCharacters - 1)}…`;
}

function qrPath(payload, x, y, size) {
  const code = QRCode.create(payload, { errorCorrectionLevel: QR.errorCorrectionLevel });
  const modules = code.modules.size;
  const totalModules = modules + QR.quietZoneModules * 2;
  const moduleSize = size / totalModules;
  const commands = [];

  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (!code.modules.get(row, column)) continue;
      const px = x + (column + QR.quietZoneModules) * moduleSize;
      const py = y + (row + QR.quietZoneModules) * moduleSize;
      commands.push(`M${number(px)} ${number(py)}h${number(moduleSize)}v${number(moduleSize)}h-${number(moduleSize)}z`);
    }
  }

  return { data: commands.join(""), modules, totalModules, moduleSizeMm: number(moduleSize) };
}

function roleGlyphs() {
  const items = [
    { x: 18, label: "BUILD", icon: '<path d="M8 12h11v11H8zM13.5 5 24 12H3z"/>' },
    { x: 69, label: "GROW", icon: '<path d="M14 25V12m0 3C7 15 5 10 5 6c6 0 9 3 9 9Zm0 5c7 0 10-4 10-10-7 0-10 4-10 10Z"/>' },
    { x: 120, label: "REPAIR", icon: '<path d="m7 23 7-7m2-2 6-6m-9 0 7 7M6 20l3 3M19 6l3 3"/><circle cx="14.5" cy="14.5" r="2.5"/>' },
    { x: 171, label: "POWER", icon: '<path d="m16 3-9 13h7l-2 10 10-15h-7z"/>' },
    { x: 222, label: "CARE", icon: '<path d="M14 24S4 18 4 11c0-6 7-7 10-2 3-5 10-4 10 2 0 7-10 13-10 13Z"/>' },
  ];

  return items
    .map(
      ({ x, label, icon }) => `
      <g transform="translate(${x} 369)" class="role">
        <circle cx="14" cy="14" r="14" fill="#071410" stroke="#62f59b" stroke-width=".8"/>
        <g transform="translate(4 4) scale(.72)" fill="none" stroke="#62f59b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</g>
        <text x="14" y="36" text-anchor="middle">${label}</text>
      </g>`,
    )
    .join("");
}

function artwork(manifest, qr) {
  const metadataJson = JSON.stringify(manifest, null, 2);
  const displayHost = compactLabel(
    new URL(manifest.canonicalUrl).hostname.replace(/^www\./, ""),
    34,
  ).toLowerCase();
  const campaignLabel = compactLabel(manifest.campaign, 24);
  const footerCampaignLabel = compactLabel(manifest.campaign, 18);
  const qrX = 213;
  const qrY = 278;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${PAGE.widthMm}mm" height="${PAGE.heightMm}mm" viewBox="0 0 ${PAGE.widthMm} ${PAGE.heightMm}" role="img" aria-labelledby="title desc">
  <title id="title">AFTERHOURS — The city is still awake</title>
  <desc id="desc">A3 campaign poster for a live cooperative city-survival game. Scan the QR code to join the founding playtest.</desc>
  <metadata id="afterhours-poster-manifest"><![CDATA[${cdata(metadataJson)}]]></metadata>
  <defs>
    <linearGradient id="night" x1="0" y1="0" x2=".72" y2="1">
      <stop offset="0" stop-color="#102e27"/>
      <stop offset=".5" stop-color="#071511"/>
      <stop offset="1" stop-color="#020604"/>
    </linearGradient>
    <linearGradient id="signal" x1="0" x2="1">
      <stop stop-color="#62f59b"/>
      <stop offset="1" stop-color="#d8ff63"/>
    </linearGradient>
    <radialGradient id="coreGlow">
      <stop stop-color="#62f59b" stop-opacity=".52"/>
      <stop offset=".5" stop-color="#62f59b" stop-opacity=".12"/>
      <stop offset="1" stop-color="#62f59b" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M10 0H0v10" fill="none" stroke="#62f59b" stroke-opacity=".07" stroke-width=".35"/>
    </pattern>
    <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx=".7" cy=".7" r=".34" fill="#e9f5ed" opacity=".14"/>
    </pattern>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="2.4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="page"><rect width="297" height="420"/></clipPath>
    <style><![CDATA[
      text { font-family: Inter, Arial, Helvetica, sans-serif; }
      .caps { font-weight: 800; letter-spacing: 1.4px; }
      .role text { fill: #d4e0d9; font-size: 3.05px; font-weight: 800; letter-spacing: .55px; }
    ]]></style>
  </defs>

  <g clip-path="url(#page)">
    <rect width="297" height="420" fill="url(#night)"/>
    <rect width="297" height="420" fill="url(#grid)"/>
    <rect x="0" y="0" width="64" height="420" fill="url(#dots)" opacity=".55"/>

    <!-- Registration-safe decorative marks remain inside the 10 mm live area. -->
    <g stroke="#62f59b" stroke-width=".55" opacity=".68">
      <path d="M10 18v-8h8M279 10h8v8M287 402v8h-8M18 410h-8v-8" fill="none"/>
    </g>

    <!-- Signal moon and skyline depth. -->
    <circle cx="234" cy="91" r="63" fill="url(#coreGlow)"/>
    <circle cx="234" cy="91" r="29" fill="none" stroke="#62f59b" stroke-opacity=".2" stroke-width=".6"/>
    <circle cx="234" cy="91" r="19" fill="none" stroke="#62f59b" stroke-opacity=".42" stroke-width=".7"/>
    <path d="M214 91a20 20 0 0 1 40 0M220 91a14 14 0 0 1 28 0M227 91a7 7 0 0 1 14 0" fill="none" stroke="#62f59b" stroke-linecap="round" stroke-width="1.05" filter="url(#glow)"/>
    <circle cx="234" cy="92" r="2.1" fill="#d8ff63" filter="url(#glow)"/>

    <path d="M0 191h14v-29h13v29h12v-44h18v44h13v-59h20v59h12v-36h24v36h15v-70h25v70h11v-49h23v49h17v-77h28v77h13v-53h18v53h33v95H0Z" fill="#0a241c"/>
    <g fill="#62f59b" opacity=".32">
      <path d="M75 142h3v4h-3zM84 142h3v4h-3zM75 153h3v4h-3zM84 153h3v4h-3zM148 130h4v6h-4zM158 130h4v6h-4zM148 143h4v6h-4zM158 143h4v6h-4zM225 125h4v7h-4zM237 125h4v7h-4zM249 125h4v7h-4z"/>
    </g>
    <path d="M0 231 24 206l18 9 25-35 29 30 26-20 38 32 28-48 39 35 26-28 34 31 30-19v82H0Z" fill="#04100c"/>
    <path d="M0 243 45 218l36 20 43-25 33 25 42-20 41 24 57-30v81H0Z" fill="#020806"/>

    <!-- Brand lockup. -->
    <g transform="translate(18 18)">
      <path d="M10 0 19 5v10l-9 5-9-5V5Z" fill="#62f59b"/>
      <text x="10" y="14.2" text-anchor="middle" font-size="10" font-weight="950" fill="#04100c">A</text>
      <text x="27" y="8" font-size="6.5" class="caps" fill="#f2f4eb">AFTERHOURS</text>
      <text x="27" y="15.3" font-size="3" font-weight="700" letter-spacing=".8" fill="#8eaa9b">LIVE CO-OP CITY SURVIVAL</text>
    </g>
    <g transform="translate(253 20)" font-size="3.1" font-weight="800" letter-spacing=".5" text-anchor="end">
      <text fill="#62f59b">PUBLIC PLAYTEST</text>
      <text y="6" fill="#8eaa9b">NIGHT SHIFT / ${xml(campaignLabel)}</text>
    </g>

    <!-- Campaign statement. -->
    <text x="18" y="71" font-size="5" class="caps" fill="#62f59b">THE CITY IS STILL AWAKE.</text>
    <text x="15" y="111" font-size="39" font-weight="950" letter-spacing="-2.2" fill="#f2f4eb">AFTER</text>
    <text x="15" y="147" font-size="39" font-weight="950" letter-spacing="-2.2" fill="url(#signal)">HOURS</text>
    <path d="M17 157h81" stroke="#62f59b" stroke-width="1.2"/>
    <text x="18" y="167" font-size="6.4" font-weight="900" letter-spacing=".8" fill="#f2f4eb">FIVE ROLES. ONE CITY.</text>
    <text x="18" y="176" font-size="6.4" font-weight="900" letter-spacing=".8" fill="#d8ff63">TERRIBLE TIMING.</text>

    <!-- Dispatch card. -->
    <g transform="translate(18 245)">
      <rect width="171" height="91" rx="2" fill="#091a15" stroke="#29483b" stroke-width=".7"/>
      <path d="M0 13h171" stroke="#29483b" stroke-width=".5"/>
      <circle cx="8" cy="6.5" r="1.8" fill="#ff5f57"/><circle cx="14" cy="6.5" r="1.8" fill="#febc2e"/><circle cx="20" cy="6.5" r="1.8" fill="#28c840"/>
      <text x="163" y="8" text-anchor="end" font-size="3" class="caps" fill="#68877a">CIVIC DISPATCH // 02:13</text>
      <text x="10" y="30" font-size="8.2" font-weight="900" fill="#f2f4eb">FOOD IS FALLING.</text>
      <text x="10" y="41" font-size="8.2" font-weight="900" fill="#f2f4eb">THE GRID IS MOODY.</text>
      <text x="10" y="53" font-size="4.5" font-weight="650" fill="#9bb1a5">Your coworkers are strangers.</text>
      <text x="10" y="63" font-size="4.5" font-weight="650" fill="#9bb1a5">Nobody can cover the city alone.</text>
      <g transform="translate(10 72)">
        <rect width="102" height="10" rx="5" fill="#62f59b"/>
        <text x="51" y="6.8" text-anchor="middle" font-size="3.7" font-weight="950" letter-spacing=".45" fill="#04100c">SCAN IN. PICK A ROLE. KEEP IT ALIVE.</text>
      </g>
    </g>

    <!-- QR as the Civic Core. White quiet-zone plate must not be restyled. -->
    <circle cx="245" cy="310" r="51" fill="url(#coreGlow)"/>
    <g aria-label="QR code: ${xml(manifest.trackingUrl)}">
      <path d="M207 272h76v76h-76z" fill="#62f59b" opacity=".14" transform="rotate(2 245 310)"/>
      <rect x="${qrX - 2}" y="${qrY - 2}" width="${QR.sizeMm + 4}" height="${QR.sizeMm + 4}" rx="1.2" fill="#fdfefb" stroke="#62f59b" stroke-width="1"/>
      <path d="${qr.data}" fill="#020705" shape-rendering="crispEdges"/>
      <path d="M211 272h8M211 272v8M279 272h-8M279 272v8M211 346h8M211 346v-8M279 346h-8M279 346v-8" fill="none" stroke="#d8ff63" stroke-width="1.1"/>
    </g>
    <text x="245" y="354" text-anchor="middle" font-size="4.5" font-weight="950" letter-spacing=".55" fill="#d8ff63">YOUR SHIFT STARTS HERE →</text>
    <text x="245" y="361" text-anchor="middle" font-size="2.9" fill="#91aa9d">${xml(displayHost)}</text>

    <!-- Five-role strip. -->
    <path d="M18 362h261" stroke="#29483b" stroke-width=".55"/>
    ${roleGlyphs()}

    <g transform="translate(18 412)" font-size="2.8" fill="#779287">
      <text>NO DOWNLOAD  •  PLAYS IN YOUR BROWSER  •  PUBLIC PLAYTEST</text>
      <text x="261" text-anchor="end">QR / ${xml(footerCampaignLabel)}</text>
    </g>
  </g>
</svg>
`;
}

export function createPoster({ url, campaign, utmCampaign = DEFAULT_CAMPAIGN, vercelProductionAlias }) {
  const campaignCode = validateCampaignCode(campaign);
  const utmCampaignCode = validateUtmCode(utmCampaign);
  const canonicalUrl = canonicalProductionUrl(url, vercelProductionAlias);
  const trackingUrl = buildTrackingUrl(canonicalUrl, campaignCode, utmCampaignCode).toString();
  const qr = qrPath(trackingUrl, 213, 278, QR.sizeMm);
  if (qr.moduleSizeMm < 0.65) {
    throw new Error(
      `The encoded URL makes ${qr.moduleSizeMm} mm QR modules, below the 0.65 mm print floor. Use a shorter production URL.`,
    );
  }
  const payloadSha256 = createHash("sha256").update(trackingUrl).digest("hex");

  const manifest = {
    schemaVersion: 1,
    asset: "afterhours-a3-qr-poster",
    campaign: campaignCode,
    canonicalUrl: canonicalUrl.toString(),
    trackingUrl,
    tracking: {
      utm_source: "print",
      utm_medium: "qr",
      utm_campaign: utmCampaignCode,
      utm_content: "city_awake",
      qr_id: campaignCode,
    },
    page: PAGE,
    qr: {
      errorCorrectionLevel: QR.errorCorrectionLevel,
      quietZoneModules: QR.quietZoneModules,
      matrixModules: qr.modules,
      totalModules: qr.totalModules,
      printedSizeMm: QR.sizeMm,
      moduleSizeMm: qr.moduleSizeMm,
      payloadSha256,
    },
    printNotes: [
      "Print at 100% / actual size on A3 portrait stock.",
      "Do not crop, recolor, distort, or place artwork over the white QR plate.",
      "Run a physical scan test at the intended viewing distance before distribution.",
    ],
  };

  return { manifest, svg: artwork(manifest, qr) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (!args.url || !args.campaign) {
    throw new Error("Both --url and --campaign are required. Run with --help for usage.");
  }

  const { manifest, svg } = createPoster({
    url: args.url,
    campaign: args.campaign,
    utmCampaign: args["utm-campaign"],
    vercelProductionAlias: args["vercel-production-alias"],
  });
  const outputBase = resolveOutput(args.out, manifest.campaign);
  const outputDirectory = path.dirname(outputBase);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(`${outputBase}.svg`, svg, "utf8"),
    writeFile(`${outputBase}.json`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ]);

  process.stdout.write(
    [
      "AFTERHOURS poster generated",
      `SVG:      ${outputBase}.svg`,
      `Manifest: ${outputBase}.json`,
      `QR URL:   ${manifest.trackingUrl}`,
      `QR:       v${(manifest.qr.matrixModules - 17) / 4} / ECC H / ${manifest.qr.moduleSizeMm} mm modules`,
      "Next: render the SVG to PDF at A3 actual size, then scan-test the printed proof.",
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Poster generation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
