import { getSettings, toPayload, shortHost, timeAgo } from '../shared/settings.js';

const $ = (id) => document.getElementById(id);

const state = {
  tabId: null,
  result: null,
  payload: toPayload(),
  settings: null,
  sentEntry: null,
};

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

async function getTargetTab() {
  // ?tabId= lets the popup be opened as a normal page (handy for debugging).
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function requestExtraction(tabId) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'meditor:extract' });
  try {
    const res = await ask();
    if (res) return res;
  } catch {
    // No content script yet (page opened before install, or it was blocked). Inject it.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/extract.js'] });
  return ask();
}

function show(view) {
  for (const id of ['view-loading', 'view-unsupported', 'view-result']) $(id).hidden = id !== view;
  $('footer').hidden = view !== 'view-result';
}

async function load({ rescan = false } = {}) {
  if (!rescan) show('view-loading');
  state.settings = await getSettings();

  let tab;
  try {
    tab = await getTargetTab();
  } catch {
    tab = null;
  }
  if (!tab?.id) return unsupported('There is no active tab to read.');
  state.tabId = tab.id;

  if (tab.url && !/^https?:/i.test(tab.url)) {
    return unsupported(/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(tab.url)
      ? "Chrome doesn't let extensions read its own pages. Open a news article and try again."
      : 'mEditor only works on regular web pages (http / https).');
  }
  if (tab.url && /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(tab.url)) {
    return unsupported("Chrome doesn't let extensions run on the Web Store.");
  }

  let res;
  try {
    res = await requestExtraction(tab.id);
  } catch (err) {
    return unsupported('This page blocked mEditor from reading it. Try reloading the page, then open mEditor again.');
  }
  if (!res?.ok) return unsupported(res?.error || 'Something went wrong reading this page.');

  state.result = res.result;
  state.result.page.favicon = tab.favIconUrl || res.result.page.favicon;
  state.payload = toPayload(res.result.data);

  const status = await chrome.runtime.sendMessage({ type: 'meditor:status', url: state.payload.url }).catch(() => null);
  state.sentEntry = status?.sent || null;

  renderAll();
  show('view-result');
}

function unsupported(reason) {
  $('unsupported-reason').textContent = reason;
  show('view-unsupported');
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

const VERDICT_COPY = {
  article: { news: 'News article detected', blog: 'Blog post detected', article: 'Article detected' },
  maybe: 'Might be an article',
  none: "Doesn't look like an article",
};

function renderAll() {
  renderVerdict();
  renderFields();
  renderPreview();
  renderJson();
  renderFooter();
}

function renderVerdict() {
  const { detection, page } = state.result;
  const el = $('verdict');
  el.dataset.verdict = detection.verdict;

  const copy = VERDICT_COPY[detection.verdict];
  $('verdict-title').textContent = typeof copy === 'string' ? copy : copy[detection.kind] || copy.article;

  const sub = [];
  if (detection.type) sub.push(detection.type.replace(/([a-z])([A-Z])/g, '$1 $2'));
  if (page.readingMinutes) sub.push(`${page.readingMinutes} min read`);
  sub.push(page.host);
  $('verdict-sub').textContent = sub.join(' · ');

  const pct = detection.confidence;
  $('ring-label').textContent = String(pct);
  requestAnimationFrame(() => {
    $('ring-value').style.strokeDashoffset = String(97.4 * (1 - pct / 100));
  });

  const list = $('signals');
  list.replaceChildren(...detection.signals.map(({ label, pts }) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = label;
    name.title = label;
    const badge = document.createElement('span');
    badge.className = `pts${pts < 0 ? ' neg' : ''}`;
    badge.textContent = `${pts > 0 ? '+' : ''}${pts}`;
    li.append(name, badge);
    return li;
  }));
  if (!detection.signals.length) {
    const li = document.createElement('li');
    li.textContent = 'No article signals found on this page.';
    list.append(li);
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderPreview() {
  const { page } = state.result;
  const p = state.payload;

  const img = $('preview-img');
  if (p.image) {
    if (img.getAttribute('src') !== p.image) {
      img.hidden = true;
      img.onload = () => { img.hidden = false; $('preview-placeholder').hidden = true; };
      img.onerror = () => { img.hidden = true; $('preview-placeholder').hidden = false; };
      img.src = p.image;
    }
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    $('preview-placeholder').hidden = false;
  }

  const fav = $('preview-favicon');
  if (page.favicon) {
    fav.onerror = () => { fav.hidden = true; };
    fav.onload = () => { fav.hidden = false; };
    if (fav.getAttribute('src') !== page.favicon) fav.src = page.favicon;
  }
  $('preview-site').textContent = page.siteName || shortHost(p.url || page.href);

  const title = $('preview-title');
  title.textContent = p.title || 'Untitled';
  title.classList.toggle('is-empty', !p.title);

  const meta = $('preview-meta');
  meta.replaceChildren();
  const parts = [];
  if (p.authors.length) {
    const by = document.createElement('span');
    by.append('By ');
    const shown = p.authors.slice(0, 3);
    shown.forEach((name, i) => {
      const b = document.createElement('b');
      b.textContent = name;
      by.append(b);
      if (i < shown.length - 2) by.append(', ');
      else if (i === shown.length - 2) by.append(p.authors.length > 3 ? ', ' : ' and ');
    });
    if (p.authors.length > 3) by.append(` +${p.authors.length - 3}`);
    parts.push(by);
  }
  const date = formatDate(p.published_date);
  if (date) parts.push(document.createTextNode(date));
  if (!parts.length) parts.push(document.createTextNode('No byline or date found'));
  parts.forEach((node, i) => {
    if (i) meta.append(' · ');
    meta.append(node);
  });
}

function isoToLocalInput(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderFields() {
  const p = state.payload;
  $('f-title').value = p.title;
  $('f-url').value = p.url;
  $('f-url-open').href = p.url || '#';
  $('f-image').value = p.image;
  $('f-date').value = isoToLocalInput(p.published_date);
  renderDateHint();
  renderThumb();
  renderChips();
}

function renderDateHint() {
  $('f-date-iso').textContent = state.payload.published_date || 'not found';
}

function renderThumb() {
  const img = $('f-image-thumb').querySelector('img');
  if (state.payload.image) {
    img.onload = () => { img.hidden = false; };
    img.onerror = () => { img.hidden = true; };
    if (img.getAttribute('src') !== state.payload.image) img.src = state.payload.image;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }
}

function renderChips() {
  const box = $('f-authors');
  const input = $('f-author-input');
  box.querySelectorAll('.chip').forEach((c) => c.remove());
  state.payload.authors.forEach((name, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = name;
    label.title = name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.innerHTML = '<svg><use href="#i-x"/></svg>';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      state.payload.authors.splice(i, 1);
      onPayloadChanged({ chips: true });
      input.focus();
    });
    chip.append(label, remove);
    box.insertBefore(chip, input);
  });
  input.placeholder = state.payload.authors.length ? 'Add another…' : 'Add author…';
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function highlightJson(obj) {
  // Tokenize the raw JSON, escaping every piece; page-supplied text never reaches innerHTML unescaped.
  const json = JSON.stringify(obj, null, 2);
  const token = /("(?:\\.|[^"\\])*")(\s*:)?|([{}[\],])/g;
  let out = '';
  let last = 0;
  for (let m; (m = token.exec(json));) {
    out += escapeHtml(json.slice(last, m.index));
    if (m[1]) {
      const cls = m[2] ? 'k' : m[1] === '""' ? 'e' : 's';
      out += `<span class="${cls}">${escapeHtml(m[1])}</span>`;
      if (m[2]) out += `<span class="p">${escapeHtml(m[2])}</span>`;
    } else {
      out += `<span class="p">${m[3]}</span>`;
    }
    last = token.lastIndex;
  }
  return out + escapeHtml(json.slice(last));
}

function renderJson() {
  $('json-view').innerHTML = highlightJson(toPayload(state.payload));
}

function renderFooter() {
  const btn = $('send');
  if (btn.dataset.state === 'sending') return;
  const note = $('footer-note');
  const verdict = state.result?.detection.verdict;
  const host = shortHost(state.settings.webhookUrl);

  btn.dataset.state = 'idle';
  btn.dataset.tone = verdict === 'article' || state.sentEntry ? '' : 'quiet';
  btn.querySelector('use').setAttribute('href', '#i-send');

  note.className = 'footer__note';
  note.replaceChildren();
  if (!state.settings.webhookUrl) {
    btn.dataset.tone = 'quiet';
    btn.querySelector('use').setAttribute('href', '#i-gear');
    $('send-label').textContent = 'Add your webhook URL';
    note.textContent = 'mEditor needs a webhook before it can send.';
  } else if (state.sentEntry) {
    $('send-label').textContent = 'Send again';
    note.classList.add('ok');
    note.innerHTML = '<svg><use href="#i-check"/></svg>';
    note.append(`Already sent ${timeAgo(state.sentEntry.sentAt)}`);
  } else {
    $('send-label').textContent = verdict === 'article' ? 'Send to Glide' : 'Send anyway';
    const code = document.createElement('code');
    code.textContent = host;
    note.append('POSTs JSON to ', code);
  }
}

// -----------------------------------------------------------------------------
// Editing
// -----------------------------------------------------------------------------

function onPayloadChanged({ chips = false } = {}) {
  if (chips) renderChips();
  renderPreview();
  renderJson();
  if ($('send').dataset.state !== 'sending') {
    // An edit after a send/error resets the button so the new version can go out.
    if ($('send').dataset.state !== 'idle') renderFooter();
  }
}

function bindEditors() {
  $('f-title').addEventListener('input', (e) => {
    state.payload.title = e.target.value.replace(/\s*\n\s*/g, ' ');
    onPayloadChanged();
  });
  $('f-url').addEventListener('input', (e) => {
    state.payload.url = e.target.value.trim();
    $('f-url-open').href = state.payload.url || '#';
    onPayloadChanged();
  });
  $('f-image').addEventListener('input', (e) => {
    state.payload.image = e.target.value.trim();
    renderThumb();
    onPayloadChanged();
  });
  $('f-date').addEventListener('input', (e) => {
    const d = e.target.value ? new Date(e.target.value) : null;
    state.payload.published_date = d && !Number.isNaN(d.getTime()) ? d.toISOString() : '';
    renderDateHint();
    onPayloadChanged();
  });

  const input = $('f-author-input');
  const commit = () => {
    const names = input.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return false;
    for (const n of names) {
      if (!state.payload.authors.some((a) => a.toLowerCase() === n.toLowerCase())) state.payload.authors.push(n);
    }
    input.value = '';
    onPayloadChanged({ chips: true });
    return true;
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (input.value.trim()) {
        e.preventDefault();
        commit();
      }
    } else if (e.key === 'Backspace' && !input.value && state.payload.authors.length) {
      state.payload.authors.pop();
      onPayloadChanged({ chips: true });
    }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('paste', () => setTimeout(() => { if (/[,;]/.test(input.value)) commit(); }));
  $('f-authors').addEventListener('click', () => input.focus());
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

async function send() {
  const btn = $('send');
  if (btn.dataset.state === 'sending') return;
  if (!state.settings.webhookUrl) {
    chrome.runtime.openOptionsPage();
    return;
  }
  // Pick up an author that was typed but not yet committed.
  if ($('f-author-input').value.trim()) $('f-author-input').dispatchEvent(new Event('blur'));

  const note = $('footer-note');
  btn.dataset.state = 'sending';
  btn.dataset.tone = '';
  btn.disabled = true;
  $('send-label').textContent = 'Sending…';

  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'meditor:send', payload: state.payload, tabId: state.tabId });
  } catch (err) {
    res = { ok: false, error: String(err?.message || err) };
  }
  btn.disabled = false;

  note.className = 'footer__note';
  note.replaceChildren();
  if (res?.ok) {
    btn.dataset.state = 'sent';
    btn.querySelector('use').setAttribute('href', '#i-check');
    $('send-label').textContent = 'Sent to Glide';
    note.classList.add('ok');
    note.textContent = `Delivered · HTTP ${res.status}`;
    state.sentEntry = { sentAt: res.sentAt || Date.now() };
  } else {
    btn.dataset.state = 'error';
    btn.querySelector('use').setAttribute('href', '#i-alert');
    $('send-label').textContent = 'Failed — try again';
    note.classList.add('bad');
    note.textContent = res?.error || 'Unknown error';
    note.title = res?.response || '';
    if (res?.needsSetup) {
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.className = 'footer__fix';
      fix.textContent = 'Open Settings';
      fix.addEventListener('click', () => chrome.runtime.openOptionsPage());
      note.append(fix);
    }
  }
}

function selectTab(which) {
  const json = which === 'json';
  $('tab-fields').setAttribute('aria-selected', String(!json));
  $('tab-json').setAttribute('aria-selected', String(json));
  $('panel-fields').hidden = json;
  $('panel-json').hidden = !json;
  document.querySelector('.tabs').dataset.active = which;
}

async function copyJson() {
  const btn = $('copy-json');
  try {
    await navigator.clipboard.writeText(JSON.stringify(toPayload(state.payload), null, 2));
    btn.querySelector('span').textContent = 'Copied';
    btn.querySelector('use').setAttribute('href', '#i-check');
  } catch {
    btn.querySelector('span').textContent = 'Copy failed';
  }
  setTimeout(() => {
    btn.querySelector('span').textContent = 'Copy';
    btn.querySelector('use').setAttribute('href', '#i-copy');
  }, 1400);
}

function bindUi() {
  $('send').addEventListener('click', send);
  $('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('refresh').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.classList.remove('spin');
    void b.offsetWidth;
    b.classList.add('spin');
    await load({ rescan: true });
  });
  $('verdict-toggle').addEventListener('click', (e) => {
    const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
    e.currentTarget.setAttribute('aria-expanded', String(open));
    $('signals').hidden = !open;
  });
  $('tab-fields').addEventListener('click', () => selectTab('fields'));
  $('tab-json').addEventListener('click', () => selectTab('json'));
  $('copy-json').addEventListener('click', copyJson);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
  bindEditors();
}

bindUi();
load();
