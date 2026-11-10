import { DEFAULTS, HISTORY_LIMIT, getSettings, getDefaultWebhookUrl, toPayload } from './shared/settings.js';

// -----------------------------------------------------------------------------
// Toolbar badge
// -----------------------------------------------------------------------------

const BADGES = {
  article: { text: '✓', color: '#15803d', title: (r) => `News article detected (${r.detection.confidence}% confidence) — click to clip` },
  maybe: { text: '?', color: '#b45309', title: (r) => `Might be an article (${r.detection.confidence}% confidence)` },
  sent: { text: '↑', color: '#1e407c', title: () => 'Already saved to mEditor' },
};

async function setBadge(tabId, state, result) {
  const badge = BADGES[state];
  try {
    if (!badge) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: 'mEditor — no article on this page' });
      return;
    }
    await chrome.action.setBadgeText({ tabId, text: badge.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    await chrome.action.setTitle({ tabId, title: `mEditor — ${badge.title(result)}` });
  } catch {
    // Tab closed or navigated away; nothing to update.
  }
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

async function getHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  return history;
}

async function addHistory(entry) {
  const history = await getHistory();
  history.unshift(entry);
  await chrome.storage.local.set({ history: history.slice(0, HISTORY_LIMIT) });
}

async function lastSuccessfulSend(url) {
  if (!url) return null;
  return (await getHistory()).find((h) => h.ok && h.payload?.url === url) || null;
}

// -----------------------------------------------------------------------------
// Webhook
// -----------------------------------------------------------------------------

async function sendToWebhook(rawPayload, { tabId, source = 'manual' } = {}) {
  const payload = toPayload(rawPayload);
  const { webhookUrl } = await getSettings();
  const entry = { id: crypto.randomUUID(), sentAt: Date.now(), source, payload, webhookUrl, ok: false };

  if (!payload.url) {
    return { ok: false, error: 'Nothing to send: the article link is empty.' };
  }
  if (!webhookUrl) {
    return { ok: false, needsSetup: true, error: 'mEditor isn’t connected yet. Open Settings to connect it.' };
  }

  let target;
  try {
    target = new URL(webhookUrl);
    if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
  } catch {
    return { ok: false, needsSetup: true, error: 'The mEditor address in Settings isn’t valid.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(target.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const body = (await res.text().catch(() => '')).slice(0, 500);
    Object.assign(entry, { ok: res.ok, status: res.status, response: body });
    if (!res.ok) {
      // Users see a plain, branded message. The technical cause (the relay's {"error"}
      // or a short plain-text body) is kept as `detail` for the tooltip and history.
      let reason = '';
      try { reason = JSON.parse(body)?.error || ''; } catch { /* not JSON */ }
      const text = body.trim();
      if (!reason && text && text.length <= 140 && !text.includes('<')) reason = text;
      entry.detail = `HTTP ${res.status}${reason ? `: ${reason}` : ''}`;
      // A 400 from the relay is about the clip itself (e.g. a title that's too long), which
      // the user can fix, so show its reason. Everything else is a service-side problem.
      entry.error = res.status === 400 && reason
        ? `mEditor couldn’t save this clip: ${reason}`
        : 'mEditor couldn’t save this clip right now. Try again in a moment.';
    }
  } catch (err) {
    entry.detail = String(err?.message || err);
    entry.error = err?.name === 'AbortError'
      ? 'mEditor didn’t respond in time. Try again in a moment.'
      : 'Couldn’t reach mEditor. Check your connection and try again.';
  } finally {
    clearTimeout(timer);
  }

  if (source !== 'test') await addHistory(entry);
  if (entry.ok && tabId != null) await setBadge(tabId, 'sent');

  return {
    ok: entry.ok,
    status: entry.status,
    error: entry.error,
    detail: entry.detail,
    response: entry.response,
    sentAt: entry.sentAt,
  };
}

// -----------------------------------------------------------------------------
// Detection reports from content scripts (+ optional auto-send)
// -----------------------------------------------------------------------------

const inflight = new Set();

async function onDetected(tabId, result) {
  const url = result?.data?.url;
  const previous = await lastSuccessfulSend(url);
  if (previous) {
    await setBadge(tabId, 'sent', result);
    return;
  }
  await setBadge(tabId, result.detection.verdict, result);

  const settings = await getSettings();
  // Auto-send rides on automatic detection; a page read because the user clicked the
  // icon must never be sent without them pressing Send.
  if (!settings.autoDetect || !settings.autoSend || !settings.webhookUrl) return;
  if (result.detection.verdict !== 'article') return;
  if (result.detection.confidence < settings.autoSendThreshold) return;
  if (!url || inflight.has(url)) return;

  inflight.add(url);
  try {
    await sendToWebhook(result.data, { tabId, source: 'auto' });
  } finally {
    inflight.delete(url);
  }
}

// -----------------------------------------------------------------------------
// Messaging
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from this extension's own pages and content scripts.
  if (sender.id !== chrome.runtime.id) return false;

  switch (msg?.type) {
    case 'meditor:detected':
      if (sender.tab?.id != null && msg.result) onDetected(sender.tab.id, msg.result);
      return false;

    case 'meditor:send':
      sendToWebhook(msg.payload, { tabId: msg.tabId, source: msg.source === 'test' ? 'test' : 'manual' }).then(sendResponse);
      return true;

    case 'meditor:status':
      lastSuccessfulSend(msg.url).then((entry) => sendResponse({ sent: entry }));
      return true;

    case 'meditor:history':
      getHistory().then((history) => sendResponse({ history }));
      return true;

    case 'meditor:clear-history':
      chrome.storage.local.set({ history: [] }).then(() => sendResponse({ ok: true }));
      return true;

    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Seed defaults without clobbering anything the user already set. The webhook URL is
  // not seeded: leaving it unset means a newer build's default always takes effect.
  const current = await chrome.storage.sync.get(null);
  const missing = Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => k !== 'webhookUrl' && !(k in current)));
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);

  // Up to v1.1 the Glide URL was stored directly (and a bearer token could be saved
  // locally). Clips now go through the relay, so drop both in favour of the default.
  // Runs on every install event: Chrome reports some upgrades of unpacked extensions
  // as "install" rather than "update", and on a clean profile this is a no-op.
  if (/^https:\/\/go\.glideapps\.com\//i.test(current.webhookUrl || '') && (await getDefaultWebhookUrl())) {
    await chrome.storage.sync.remove('webhookUrl');
  }
  await chrome.storage.local.remove('webhookToken');

  if (reason === 'install' && !(await getSettings()).webhookUrl) {
    // Built without a default webhook: send the user straight to Settings to add one.
    chrome.runtime.openOptionsPage().catch(() => {});
  }

  await syncDetection();
});

// -----------------------------------------------------------------------------
// Automatic detection (opt-in)
// -----------------------------------------------------------------------------
// Without it mEditor only reads a page when the user clicks the icon (activeTab). With
// it, the content script is registered for every http(s) page, which needs the optional
// all-sites host permission the user grants from Settings.

const DETECT_ID = 'meditor-detect';
const ALL_SITES = ['http://*/*', 'https://*/*'];
let syncing = Promise.resolve();

function syncDetection() {
  // Serialized so overlapping triggers can't register the script twice.
  syncing = syncing.then(applyDetection, applyDetection);
  return syncing;
}

async function applyDetection() {
  try {
    const { autoDetect } = await getSettings();
    const granted = await chrome.permissions.contains({ origins: ALL_SITES });
    const want = autoDetect && granted;
    const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [DETECT_ID] })).length > 0;
    if (want && !registered) {
      await chrome.scripting.registerContentScripts([{
        id: DETECT_ID,
        matches: ALL_SITES,
        js: ['src/content/extract.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]);
      // Badge the tabs that are already open, too.
      const tabs = await chrome.tabs.query({ url: ALL_SITES }).catch(() => []);
      for (const tab of tabs) {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/extract.js'] }).catch(() => {});
      }
    } else if (!want && registered) {
      await chrome.scripting.unregisterContentScripts({ ids: [DETECT_ID] });
    }
  } catch (err) {
    console.warn('mEditor: could not update automatic detection', err);
  }
}

chrome.permissions.onAdded.addListener(syncDetection);
chrome.permissions.onRemoved.addListener(syncDetection);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'autoDetect' in changes) syncDetection();
});
chrome.runtime.onStartup.addListener(syncDetection);
