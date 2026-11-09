import { DEFAULT_WEBHOOK_URL, getSettings, saveSettings, originPattern, shortHost, timeAgo } from '../shared/settings.js';

const $ = (id) => document.getElementById(id);

const SAMPLE = {
  url: 'https://example.com/2026/11/09/meditor-test',
  title: 'Meditor test payload — you can delete this row',
  image: 'https://example.com/lead-image.jpg',
  published_date: new Date().toISOString(),
  authors: ['Meditor Test'],
};

function setStatus(kind, text) {
  const el = $('webhook-status');
  el.className = `status ${kind || ''}`;
  el.replaceChildren();
  if (kind) el.innerHTML = `<svg><use href="#i-${kind === 'ok' ? 'check' : 'alert'}"/></svg>`;
  el.append(text || '');
}

function parseWebhook(value) {
  try {
    const u = new URL(value.trim());
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Must run straight from a click: chrome.permissions.request needs the user gesture,
 * so nothing async may happen before it.
 */
async function saveWebhook() {
  const url = parseWebhook($('webhook').value);
  if (!url) {
    setStatus('bad', 'Enter a valid http(s) URL.');
    return false;
  }
  let granted = true;
  try {
    granted = await chrome.permissions.request({ origins: [originPattern(url)] });
  } catch {
    granted = false;
  }
  if (!granted) {
    setStatus('bad', `Permission to contact ${shortHost(url)} was declined.`);
    return false;
  }
  const saved = await saveSettings({ webhookUrl: url, webhookToken: $('token').value });
  $('webhook').value = url;
  $('token').value = saved.webhookToken;
  return true;
}

async function onSave() {
  if (await saveWebhook()) {
    const { webhookToken } = await getSettings();
    setStatus('ok', webhookToken ? 'Saved, with bearer token' : 'Saved');
  }
}

async function onTest() {
  const btn = $('test');
  if (!(await saveWebhook())) return;
  btn.disabled = true;
  setStatus('', 'Sending test…');
  const res = await chrome.runtime.sendMessage({ type: 'meditor:send', payload: SAMPLE, source: 'test' }).catch((e) => ({ ok: false, error: String(e) }));
  btn.disabled = false;
  if (res?.ok) setStatus('ok', `Webhook accepted the test (HTTP ${res.status})`);
  else setStatus('bad', res?.error || 'Test failed');
}

async function onReset() {
  if (!DEFAULT_WEBHOOK_URL) return;
  $('webhook').value = DEFAULT_WEBHOOK_URL;
  await saveSettings({ webhookUrl: DEFAULT_WEBHOOK_URL });
  setStatus('ok', 'Restored the default Glide webhook');
}

function renderAuto(settings) {
  $('auto').checked = settings.autoSend;
  $('threshold').value = String(settings.autoSendThreshold);
  $('threshold-out').textContent = `${settings.autoSendThreshold}%`;
  $('threshold-row').classList.toggle('is-off', !settings.autoSend);
}

async function renderHistory() {
  const { history = [] } = await chrome.runtime.sendMessage({ type: 'meditor:history' }).catch(() => ({}));
  const list = $('history');
  $('history-empty').hidden = history.length > 0;
  $('clear').hidden = history.length === 0;

  list.replaceChildren(...history.map((h) => {
    const p = h.payload || {};
    const li = document.createElement('li');

    const thumb = document.createElement('span');
    thumb.className = 'history__thumb';
    if (/^https?:/i.test(p.image || '')) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.remove();
      img.src = p.image;
      thumb.append(img);
    }

    const main = document.createElement('div');
    main.className = 'history__main';
    const a = document.createElement('a');
    a.className = 'history__title';
    a.textContent = p.title || p.url || 'Untitled';
    a.title = p.title || '';
    if (/^https?:/i.test(p.url || '')) a.href = p.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const meta = document.createElement('div');
    meta.className = 'history__meta';
    meta.textContent = [
      shortHost(p.url || ''),
      p.authors?.length ? p.authors.join(', ') : null,
      `${!h.ok ? 'failed' : h.source === 'auto' ? 'auto-sent' : 'sent'} ${timeAgo(h.sentAt)}`,
    ].filter(Boolean).join(' · ');
    main.append(a, meta);

    const tag = document.createElement('span');
    tag.className = `tag${h.ok ? '' : ' bad'}`;
    tag.innerHTML = `<svg><use href="#i-${h.ok ? 'check' : 'alert'}"/></svg>`;
    tag.append(h.ok ? String(h.status || 'OK') : h.status ? `HTTP ${h.status}` : 'Failed');
    if (!h.ok) tag.title = h.error || '';

    li.append(thumb, main, tag);
    return li;
  }));
}

async function init() {
  const settings = await getSettings();
  $('webhook').value = settings.webhookUrl;
  $('token').value = settings.webhookToken;
  $('webhook').placeholder = 'https://go.glideapps.com/api/container/plugin/webhook-trigger/…';
  // Builds packaged without a default webhook have nothing to reset to.
  $('reset').hidden = !DEFAULT_WEBHOOK_URL;
  if (!settings.webhookUrl) {
    setStatus('bad', 'Paste your Glide webhook URL and press Save to start clipping.');
    $('webhook').focus();
  }
  renderAuto(settings);
  renderHistory();

  $('save').addEventListener('click', onSave);
  $('test').addEventListener('click', onTest);
  $('reset').addEventListener('click', onReset);
  $('webhook').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSave(); });
  $('webhook').addEventListener('input', () => setStatus('', ''));
  $('token').addEventListener('input', () => setStatus('', ''));
  $('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSave(); });
  $('token-toggle').addEventListener('click', () => {
    const show = $('token').type === 'password';
    $('token').type = show ? 'text' : 'password';
    $('token-toggle').textContent = show ? 'Hide' : 'Show';
  });

  $('auto').addEventListener('change', async (e) => renderAuto(await saveSettings({ autoSend: e.target.checked })));
  $('threshold').addEventListener('input', (e) => { $('threshold-out').textContent = `${e.target.value}%`; });
  $('threshold').addEventListener('change', async (e) => renderAuto(await saveSettings({ autoSendThreshold: Number(e.target.value) })));

  $('clear').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'meditor:clear-history' });
    renderHistory();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.history) renderHistory();
    if (area === 'sync') getSettings().then(renderAuto);
  });
}

init();
