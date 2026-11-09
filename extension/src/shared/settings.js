// Shared between the background worker, popup and options page (ES module).

// Where clips are POSTed by default: normally your Meditor relay (relay/ in this repo),
// which holds the Glide webhook URL and bearer token so neither ships in the extension.
// It lives in /config.json, which `npm run package` fills in from the gitignored
// .webhook-url file (or $MEDITOR_WEBHOOK_URL). It is read at runtime rather than
// compiled into this module because Chrome can keep serving a stale copy of a service
// worker's imported modules after an update. A user can still override it in Settings.
let configPromise;
export function getConfig() {
  configPromise ||= fetch(chrome.runtime.getURL('config.json'), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return configPromise;
}

export async function getDefaultWebhookUrl() {
  const { webhookUrl } = await getConfig();
  return typeof webhookUrl === 'string' ? webhookUrl.trim() : '';
}

export const DEFAULTS = Object.freeze({
  webhookUrl: '',
  // Off by default: nothing leaves the browser unless you press "Send".
  autoSend: false,
  autoSendThreshold: 70,
});

export const HISTORY_LIMIT = 100;

export async function getSettings() {
  const [stored, fallback] = await Promise.all([chrome.storage.sync.get(DEFAULTS), getDefaultWebhookUrl()]);
  // An empty stored URL means "use the built-in default".
  return { ...DEFAULTS, ...stored, webhookUrl: stored.webhookUrl || fallback };
}

export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
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
