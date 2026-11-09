import { DEFAULTS, HISTORY_LIMIT, getSettings, toPayload, originPattern } from './shared/settings.js';

// -----------------------------------------------------------------------------
// Toolbar badge
// -----------------------------------------------------------------------------

const BADGES = {
  article: { text: '✓', color: '#15803d', title: (r) => `News article detected (${r.detection.confidence}% confidence) — click to clip` },
  maybe: { text: '?', color: '#b45309', title: (r) => `Might be an article (${r.detection.confidence}% confidence)` },
  sent: { text: '↑', color: '#1e407c', title: () => 'Already sent to your webhook' },
};

async function setBadge(tabId, state, result) {
  const badge = BADGES[state];
  try {
    if (!badge) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: 'Meditor — no article on this page' });
      return;
    }
    await chrome.action.setBadgeText({ tabId, text: badge.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    await chrome.action.setTitle({ tabId, title: `Meditor — ${badge.title(result)}` });
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
  const { webhookUrl, webhookToken } = await getSettings();
  const entry = { id: crypto.randomUUID(), sentAt: Date.now(), source, payload, webhookUrl, ok: false };

  if (!payload.url) {
    return { ok: false, error: 'Nothing to send: the URL is empty.' };
  }
  if (!webhookUrl) {
    return { ok: false, needsSetup: true, error: 'No webhook URL yet. Add it in Settings.' };
  }

  let target;
  try {
    target = new URL(webhookUrl);
    if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
  } catch {
    return { ok: false, error: 'The webhook URL in Settings is not a valid http(s) URL.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(target.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const body = (await res.text().catch(() => '')).slice(0, 500);
    Object.assign(entry, { ok: res.ok, status: res.status, response: body });
    if (res.status === 401 || res.status === 403) {
      entry.authError = true;
      entry.error = webhookToken
        ? `The webhook rejected the bearer token (HTTP ${res.status}). Copy it again from the Glide trigger into Settings.`
        : `The webhook requires a bearer token (HTTP ${res.status}). Add it in Settings.`;
    } else if (!res.ok) {
      entry.error = `Webhook responded ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
    }
  } catch (err) {
    let error = err?.name === 'AbortError' ? 'The webhook did not respond within 20 seconds.' : `Network error: ${err?.message || err}`;
    if (err?.name !== 'AbortError') {
      const granted = await chrome.permissions.contains({ origins: [originPattern(target.href)] }).catch(() => true);
      if (!granted) error = `Meditor isn't allowed to contact ${target.host}. Open Settings and save the webhook again to grant access.`;
    }
    entry.error = error;
  } finally {
    clearTimeout(timer);
  }

  if (source !== 'test') await addHistory(entry);
  if (entry.ok && tabId != null) await setBadge(tabId, 'sent');

  return {
    ok: entry.ok,
    status: entry.status,
    error: entry.error,
    authError: !!entry.authError,
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
  if (!settings.autoSend || !settings.webhookUrl) return;
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
  // Seed defaults without clobbering anything the user already set.
  const current = await chrome.storage.sync.get(null);
  const missing = Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => !(k in current)));
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);

  if (reason === 'install' && !(await chrome.storage.sync.get('webhookUrl')).webhookUrl) {
    // Built without a default webhook: send the user straight to Settings to add one.
    chrome.runtime.openOptionsPage().catch(() => {});
  }

  if (reason === 'install') {
    // Run detection on tabs that were already open before the install.
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => []);
    for (const tab of tabs) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/extract.js'] }).catch(() => {});
    }
  }
});
