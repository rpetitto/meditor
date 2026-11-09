/**
 * Meditor relay: a Cloudflare Worker between the extension and Glide.
 *
 * The Glide webhook URL and its bearer token live here as Worker secrets, so
 * neither ships inside the extension. The relay only forwards well-formed
 * clips ({url, title, image, published_date, authors}) sent from a Chrome
 * extension, and adds the Authorization header itself.
 *
 * Secrets (Worker → Settings → Variables and Secrets, type "Secret"):
 *   GLIDE_WEBHOOK_URL   https://go.glideapps.com/api/container/plugin/webhook-trigger/…
 *   GLIDE_TOKEN         the bearer token shown on the Glide webhook trigger
 * Optional variable:
 *   ALLOWED_ORIGINS     comma-separated origins, e.g. "chrome-extension://abc…".
 *                       Default: any chrome-extension:// origin.
 *
 * Note: the Origin check keeps web pages and casual scripts out, but it is not
 * authentication (a determined client can fake it). What it guarantees is that
 * the token never leaves this Worker and only valid clips reach Glide.
 */

const MAX_BODY_BYTES = 16 * 1024;
const LIMITS = { url: 2048, title: 500, image: 2048, published_date: 64, author: 120, authors: 25 };
const FIELDS = ['url', 'title', 'image', 'published_date', 'authors'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = isAllowedOrigin(origin, env);
    const cors = allowed ? corsHeaders(origin) : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    }
    if (request.method === 'GET') {
      // Health check. Says whether the secrets are set, never what they are.
      return json({ ok: true, service: 'meditor-relay', configured: isConfigured(env) }, 200, cors);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Only POST is allowed.' }, 405, cors);
    }
    if (!allowed) {
      return json({ error: 'Requests must come from the Meditor extension.' }, 403);
    }
    if (!isConfigured(env)) {
      return json({ error: 'The relay is not configured yet: set GLIDE_WEBHOOK_URL and GLIDE_TOKEN.' }, 500, cors);
    }

    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_BODY_BYTES) return json({ error: 'Payload too large.' }, 413, cors);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: 'Payload too large.' }, 413, cors);

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return json({ error: 'Body must be JSON.' }, 400, cors);
    }
    const { payload, error } = validatePayload(data);
    if (error) return json({ error }, 400, cors);

    let res;
    try {
      res = await fetch(env.GLIDE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GLIDE_TOKEN.trim()}` },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({ error: 'The relay could not reach Glide. Try again in a moment.' }, 502, cors);
    }

    if (res.ok) return json({ ok: true, status: res.status }, 200, cors);
    if (res.status === 401 || res.status === 403) {
      return json({ error: 'Glide rejected the relay’s bearer token. Update GLIDE_TOKEN in the Worker settings.' }, 502, cors);
    }
    return json({ error: `Glide responded ${res.status}.` }, 502, cors);
  },
};

/** Returns { payload } with exactly the five fields, or { error }. */
export function validatePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Body must be a JSON object.' };

  const str = (key, { required = false, max }) => {
    const v = data[key] ?? '';
    if (typeof v !== 'string') throw new Error(`"${key}" must be a string.`);
    const s = v.trim();
    if (required && !s) throw new Error(`"${key}" is required.`);
    if (s.length > max) throw new Error(`"${key}" is too long.`);
    return s;
  };
  const httpUrl = (s, key) => {
    if (!s) return s;
    let u;
    try { u = new URL(s); } catch { throw new Error(`"${key}" must be a valid URL.`); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`"${key}" must be an http(s) URL.`);
    return s;
  };

  try {
    const url = httpUrl(str('url', { required: true, max: LIMITS.url }), 'url');
    const title = str('title', { max: LIMITS.title });
    const image = httpUrl(str('image', { max: LIMITS.image }), 'image');
    const published_date = str('published_date', { max: LIMITS.published_date });
    if (published_date && Number.isNaN(Date.parse(published_date))) throw new Error('"published_date" must be a date.');

    const list = data.authors ?? [];
    if (!Array.isArray(list)) throw new Error('"authors" must be an array of strings.');
    if (list.length > LIMITS.authors) throw new Error('Too many authors.');
    const authors = list.map((a) => {
      if (typeof a !== 'string') throw new Error('"authors" must be an array of strings.');
      const s = a.trim();
      if (s.length > LIMITS.author) throw new Error('An author name is too long.');
      return s;
    }).filter(Boolean);

    // Rebuild from the known fields only, so nothing extra is ever forwarded.
    const payload = { url, title, image, published_date, authors };
    return { payload: Object.fromEntries(FIELDS.map((k) => [k, payload[k]])) };
  } catch (err) {
    return { error: err.message };
  }
}

function isConfigured(env) {
  return Boolean(env.GLIDE_WEBHOOK_URL && env.GLIDE_TOKEN);
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length) return list.includes(origin);
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
