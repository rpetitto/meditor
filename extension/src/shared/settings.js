// Shared between the background worker, popup and options page (ES module).

// The webhook URL works like a password (anyone holding it can post to your Glide
// app), so it is not committed. `npm run package` fills it in from the gitignored
// .webhook-url file (or $MEDITOR_WEBHOOK_URL); otherwise set it in Settings.
export const DEFAULT_WEBHOOK_URL = '';
// Glide webhook triggers can require `Authorization: Bearer <token>`. Same treatment:
// filled in from .webhook-token / $MEDITOR_WEBHOOK_TOKEN at packaging time, or in Settings.
export const DEFAULT_WEBHOOK_TOKEN = '';

export const DEFAULTS = Object.freeze({
  webhookUrl: DEFAULT_WEBHOOK_URL,
  // Off by default: nothing leaves the browser unless you press "Send".
  autoSend: false,
  autoSendThreshold: 70,
});

// Secrets stay on this device (chrome.storage.local) and are never synced to the Google account.
export const LOCAL_DEFAULTS = Object.freeze({
  webhookToken: DEFAULT_WEBHOOK_TOKEN,
});

export const HISTORY_LIMIT = 100;

/** Accepts "abc123", "Bearer abc123" or a whole "Authorization: Bearer abc123" line. */
export function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .replace(/^authorization\s*:\s*/i, '')
    .replace(/^bearer\s+/i, '')
    .trim();
}

export async function getSettings() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get(LOCAL_DEFAULTS),
  ]);
  return { ...DEFAULTS, ...synced, webhookToken: normalizeToken(local.webhookToken) };
}

export async function saveSettings(patch) {
  const { webhookToken, ...synced } = patch;
  if (webhookToken !== undefined) await chrome.storage.local.set({ webhookToken: normalizeToken(webhookToken) });
  if (Object.keys(synced).length) await chrome.storage.sync.set(synced);
  return getSettings();
}

/** Coerce anything into exactly the webhook schema. */
export function toPayload(data = {}) {
  const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  const authors = (Array.isArray(data.authors) ? data.authors : str(data.authors) ? [data.authors] : [])
    .map(str)
    .filter(Boolean);
  return {
    url: str(data.url),
    title: str(data.title),
    image: str(data.image),
    published_date: str(data.published_date),
    authors,
  };
}

/** Origin match pattern for a URL, e.g. "https://example.com/*". */
export function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

export function shortHost(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}
