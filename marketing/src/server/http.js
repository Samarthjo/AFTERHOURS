import { IntakeError } from './intake.js';

export const MAX_BODY_BYTES = 2_048;

function firstHeader(request, name) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requestOrigin(request) {
  const host = firstHeader(request, 'host');
  if (!host || /[\s\\/]/.test(host)) return null;
  const forwarded = firstHeader(request, 'x-forwarded-proto');
  const protocol = String(forwarded || 'https').split(',')[0].trim().toLowerCase();
  if (protocol !== 'http' && protocol !== 'https') return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function configuredOrigins(request) {
  const origins = new Set();
  const sameOrigin = requestOrigin(request);
  if (sameOrigin) origins.add(sameOrigin);

  for (const value of [
    process.env.SITE_ORIGIN,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]) {
    if (!value) continue;
    const candidate = value.includes('://') ? value : `https://${value}`;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Ignore malformed deployment configuration; the same-origin check remains.
    }
  }
  return origins;
}

function assertSameOrigin(request) {
  const fetchSite = firstHeader(request, 'sec-fetch-site');
  if (fetchSite === 'cross-site') throw new IntakeError(403, 'origin_denied');

  const origin = firstHeader(request, 'origin');
  if (!origin) return;
  let normalized;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new IntakeError(403, 'origin_denied');
  }
  if (!configuredOrigins(request).has(normalized)) {
    throw new IntakeError(403, 'origin_denied');
  }
}

async function rawBody(request) {
  if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body)) return request.body;
    if (typeof request.body === 'string') return Buffer.from(request.body, 'utf8');
    return Buffer.from(JSON.stringify(request.body), 'utf8');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new IntakeError(413, 'payload_too_large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const contentType = firstHeader(request, 'content-type');
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new IntakeError(415, 'json_required');
  }

  const declaredSize = Number(firstHeader(request, 'content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new IntakeError(413, 'payload_too_large');
  }

  const bytes = await rawBody(request);
  if (bytes.length === 0) throw new IntakeError(400, 'invalid_json');
  if (bytes.length > MAX_BODY_BYTES) throw new IntakeError(413, 'payload_too_large');
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new IntakeError(400, 'invalid_json');
  }
}

function responseHeaders(response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Vary', 'Origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function send(response, status, body) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

async function supabaseRpc(name, parameters) {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) throw new Error('backend_not_configured');

  let endpoint;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') throw new Error('invalid_backend_url');
    endpoint = new URL(`/rest/v1/rpc/${name}`, url).toString();
  } catch {
    throw new Error('backend_not_configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const result = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parameters),
      signal: controller.signal,
    });
    if (!result.ok) throw new Error('database_rejected_request');
  } finally {
    clearTimeout(timeout);
  }
}

export async function acceptIntake(request, response, options) {
  responseHeaders(response);
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    send(response, 405, { accepted: false, error: 'method_not_allowed' });
    return;
  }

  try {
    assertSameOrigin(request);
    const value = options.validate(await readJson(request));
    await supabaseRpc(options.rpc, options.parameters(value));
    send(response, 202, { accepted: true });
  } catch (error) {
    if (error instanceof IntakeError) {
      if (error.code === 'honeypot') {
        // Acknowledge bots without retaining their submitted data.
        send(response, 202, { accepted: true });
        return;
      }
      send(response, error.status, { accepted: false, error: error.code });
      return;
    }
    response.setHeader('Retry-After', '5');
    send(response, 503, { accepted: false, error: 'temporarily_unavailable' });
  }
}
