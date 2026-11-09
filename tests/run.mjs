// End-to-end tests for Meditor.
//
//   node tests/run.mjs            # run everything
//   node tests/run.mjs --shots    # also write popup/options screenshots to docs/
//
// 1. Loads each fixture in a plain page, injects the content script and checks
//    the detection verdict and every extracted field.
// 2. Loads the real extension in Chromium, opens an article, checks the toolbar
//    badge, drives the popup, presses "Send" and checks the exact JSON that a
//    local stand-in webhook receives. The real Glide webhook is never called.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import relayWorker, { validatePayload } from '../relay/src/worker.js';
import { startRelay } from '../relay/dev-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const SHOTS = process.argv.includes('--shots');

// ---------------------------------------------------------------------------
// Fixture server + fake webhook
// ---------------------------------------------------------------------------

const ROUTES = {
  '/2026/11/08/city-council-approves-riverfront-park-plan/': 'news-jsonld.html',
  '/science/researchers-map-deep-sea-vents': 'meta-only.html',
  '/local/bakery-celebrates-50-years': 'byline-dom.html',
  '/': 'homepage.html',
  '/products/trail-runner-3': 'product.html',
};
const received = [];
const SECURE_TOKEN = 'test-token-7f3a9c';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // /hook accepts anything; /secure-hook answers like a real Glide trigger that has a bearer token.
  if (url.pathname === '/hook' || url.pathname === '/secure-hook') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (url.pathname === '/secure-hook' && req.headers.authorization !== `Bearer ${SECURE_TOKEN}`) {
        return res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }).end('Invalid bearer token');
      }
      received.push({ path: url.pathname, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
    return;
  }
  const file = ROUTES[url.pathname]
    || (url.pathname.startsWith('/media/') || url.pathname.startsWith('/img/') ? path.join('media', path.basename(url.pathname)) : null);
  const full = file && path.join(FIX, file);
  if (!full || !fs.existsSync(full)) return res.writeHead(404).end('not found');
  const type = full.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/jpeg';
  res.writeHead(200, { 'Content-Type': type }).end(fs.readFileSync(full));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  ✗ ${name}\n      ${String(err.stack || err).split('\n').slice(0, 6).join('\n      ')}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Extractor
// ---------------------------------------------------------------------------

const EXTRACT_JS = path.join(EXT, 'src', 'content', 'extract.js');

console.log('\nExtractor');
const browser = await chromium.launch();
const page = await browser.newPage();

async function extractFrom(urlPath) {
  await page.goto(ORIGIN + urlPath);
  await page.addScriptTag({ path: EXTRACT_JS });
  return page.evaluate(() => globalThis.__meditor.extract());
}

await test('JSON-LD @graph article: refs, entities, canonical, tracking params', async () => {
  const r = await extractFrom('/2026/11/08/city-council-approves-riverfront-park-plan/?utm_source=x&fbclid=abc');
  assert.equal(r.detection.verdict, 'article');
  assert.equal(r.detection.kind, 'news');
  assert.ok(r.detection.confidence >= 90, `confidence ${r.detection.confidence}`);
  assert.deepEqual(r.data, {
    url: `${ORIGIN}/2026/11/08/city-council-approves-riverfront-park-plan/?id=42`,
    title: 'City council approves riverfront park plan after “marathon” session',
    image: `${ORIGIN}/media/riverfront-park.jpg`,
    published_date: '2026-11-08T19:30:00.000Z',
    authors: ['María José Álvarez', 'John E. Smith'],
  });
});

await test('Meta tags only: author meta with "By" and publisher suffix, relative og:image', async () => {
  const r = await extractFrom('/science/researchers-map-deep-sea-vents');
  assert.equal(r.detection.verdict, 'article', JSON.stringify(r.detection));
  assert.deepEqual(r.data, {
    url: `${ORIGIN}/science/researchers-map-deep-sea-vents`,
    title: 'Researchers map deep-sea vents',
    image: `${ORIGIN}/science/images/vents.jpg`,
    published_date: '2026-10-30T09:15:00.000Z',
    authors: ['Priya Raman'],
  });
});

await test('No metadata at all: DOM byline, <time>, first large <img>, title suffix stripped', async () => {
  const r = await extractFrom('/local/bakery-celebrates-50-years');
  assert.notEqual(r.detection.verdict, 'none', JSON.stringify(r.detection));
  assert.deepEqual(r.data, {
    url: `${ORIGIN}/local/bakery-celebrates-50-years`,
    title: 'Local bakery celebrates 50 years',
    image: `${ORIGIN}/img/bakery.jpg`,
    published_date: '2026-09-14T08:00:00.000Z',
    authors: ["Sam O'Neill"],
  });
});

await test('Homepage is not an article', async () => {
  const r = await extractFrom('/');
  assert.equal(r.detection.verdict, 'none', JSON.stringify(r.detection));
});

await test('Product page is not an article', async () => {
  const r = await extractFrom('/products/trail-runner-3');
  assert.equal(r.detection.verdict, 'none', JSON.stringify(r.detection));
});

await browser.close();

// ---------------------------------------------------------------------------
// 2. Relay (Cloudflare Worker code, called directly)
// ---------------------------------------------------------------------------

console.log('\nRelay');
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const RELAY_ENV = { GLIDE_WEBHOOK_URL: 'https://glide.test/hook', GLIDE_TOKEN: 'relay-secret' };
const GOOD = { url: 'https://news.test/a', title: 'T', image: '', published_date: '2026-11-08T19:30:00.000Z', authors: ['A B'] };

async function callRelay({ method = 'POST', origin = EXT_ORIGIN, body = GOOD, env = RELAY_ENV, glide = () => new Response('ok') } = {}) {
  const forwarded = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { forwarded.push({ url, init }); return glide(); };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (origin) headers.Origin = origin;
    const res = await relayWorker.fetch(new Request('https://relay.test/', {
      method, headers, body: ['GET', 'OPTIONS'].includes(method) ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    }), env);
    return { res, json: await res.clone().json().catch(() => null), forwarded };
  } finally {
    globalThis.fetch = realFetch;
  }
}

await test('forwards a valid clip to Glide with the bearer token, and only the five fields', async () => {
  const { res, json, forwarded } = await callRelay({ body: { ...GOOD, extra: 'dropped', authors: [' A B ', ''] } });
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true, status: 200 });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].url, RELAY_ENV.GLIDE_WEBHOOK_URL);
  assert.equal(forwarded[0].init.headers.Authorization, 'Bearer relay-secret');
  assert.deepEqual(JSON.parse(forwarded[0].init.body), { ...GOOD, authors: ['A B'] });
  assert.equal(res.headers.get('access-control-allow-origin'), EXT_ORIGIN);
});

await test('rejects requests that are not from a Chrome extension', async () => {
  for (const origin of [null, 'https://evil.test', 'chrome-extension://short']) {
    const { res, forwarded } = await callRelay({ origin });
    assert.equal(res.status, 403, String(origin));
    assert.equal(forwarded.length, 0);
  }
  const pinned = await callRelay({ env: { ...RELAY_ENV, ALLOWED_ORIGINS: 'chrome-extension://pppppppppppppppppppppppppppppppp' } });
  assert.equal(pinned.res.status, 403);
});

await test('rejects malformed clips without calling Glide', async () => {
  const bad = [
    'not json', [], { ...GOOD, url: '' }, { ...GOOD, url: 'javascript:alert(1)' }, { ...GOOD, image: 'ftp://x' },
    { ...GOOD, title: 5 }, { ...GOOD, authors: 'A' }, { ...GOOD, authors: [1] }, { ...GOOD, published_date: 'soon' },
    { ...GOOD, title: 'x'.repeat(501) }, { ...GOOD, authors: Array(26).fill('A') },
  ];
  for (const body of bad) {
    const { res, json, forwarded } = await callRelay({ body });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.ok(json.error);
    assert.equal(forwarded.length, 0);
  }
  const huge = await callRelay({ body: { ...GOOD, title: 'x'.repeat(20000) } });
  assert.equal(huge.res.status, 413);
});

await test('reports Glide token problems and outages without leaking the secret', async () => {
  const rejected = await callRelay({ glide: () => new Response('Invalid bearer token', { status: 401 }) });
  assert.equal(rejected.res.status, 502);
  assert.match(rejected.json.error, /rejected the relay’s bearer token/);
  const down = await callRelay({ glide: () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.res.status, 502);
  const unconfigured = await callRelay({ env: {} });
  assert.equal(unconfigured.res.status, 500);
  const health = await callRelay({ method: 'GET' });
  assert.deepEqual(health.json, { ok: true, service: 'meditor-relay', configured: true });
  for (const r of [rejected, down, unconfigured, health]) {
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes('relay-secret') && !text.includes('glide.test'), text);
  }
});

await test('answers the CORS preflight for extensions only', async () => {
  const ok = await callRelay({ method: 'OPTIONS' });
  assert.equal(ok.res.status, 204);
  assert.match(ok.res.headers.get('access-control-allow-methods'), /POST/);
  const no = await callRelay({ method: 'OPTIONS', origin: 'https://evil.test' });
  assert.equal(no.res.status, 403);
  assert.equal(no.res.headers.get('access-control-allow-origin'), null);
});

assert.ok(validatePayload(GOOD).payload);

// ---------------------------------------------------------------------------
// 3. Extension end to end
// ---------------------------------------------------------------------------

console.log('\nExtension');
// For screenshots, serve the fixture site under a realistic host name instead of 127.0.0.1:port.
const SITE = SHOTS ? 'http://www.dailyledger.test' : ORIGIN;
// A placeholder relay URL for screenshots. The real webhook is never used by the tests.
const GLIDE = 'https://meditor-relay.your-subdomain.workers.dev/';
const LOCAL_HOOK = `${ORIGIN}/hook`;

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP www.dailyledger.test:80 127.0.0.1:${server.address().port}`,
  ],
});

let worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(worker.url()).host;

await test('service worker boots and seeds default settings', async () => {
  const settings = await worker.evaluate(async () => {
    for (let i = 0; i < 20; i += 1) {
      const s = await chrome.storage.sync.get(null);
      if ('autoSend' in s) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    return chrome.storage.sync.get(null);
  });
  // The source ships without a default webhook (package.sh bakes in the relay URL), and the
  // URL is never seeded into storage, so a newer build's default always takes effect.
  assert.equal('webhookUrl' in settings, false);
  assert.equal(settings.autoSend, false);
  assert.equal(settings.autoSendThreshold, 70);
});

await test('first install without a webhook opens Settings', async () => {
  const isOptions = (p) => p.url().includes('/src/options/options.html');
  const opts = ctx.pages().find(isOptions) || await ctx.waitForEvent('page', { predicate: isOptions, timeout: 5000 });
  await opts.waitForSelector('#webhook-status.bad');
  assert.match(await opts.textContent('#webhook-status'), /Paste your Meditor relay URL/);
  assert.equal(await opts.isHidden('#reset'), true);
  await opts.close();
});

const storedWebhook = () => worker.evaluate(async () => (await chrome.storage.sync.get('webhookUrl')).webhookUrl);

// Without the "tabs" permission tab URLs/titles are hidden, so identify tabs by creation order.
const newestTabId = () => worker.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));

const article = await ctx.newPage();
await article.goto(`${SITE}/2026/11/08/city-council-approves-riverfront-park-plan/?utm_source=x`);
const tabId = await newestTabId();

const badge = async () => worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
};

await test('toolbar badge marks the article', async () => {
  assert.equal(await waitFor(async () => (await badge()) === '✓' && '✓'), '✓');
});

const popup = await ctx.newPage();
await popup.setViewportSize({ width: 384, height: 600 });
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${tabId}`);

await test('without a webhook, the send button asks for one instead', async () => {
  await popup.waitForSelector('#view-result:not([hidden])');
  assert.equal(await popup.textContent('#send-label'), 'Add your webhook URL');
  assert.match(await popup.textContent('#footer-note'), /needs a webhook/);
});

// Point the extension at the local stand-in webhook. For screenshots, show a placeholder
// Glide URL instead; nothing is sent while it is set, and the local hook is restored
// (and asserted) before the first Send.
await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), SHOTS ? GLIDE : LOCAL_HOOK);
await popup.reload();

await test('popup shows verdict, preview and editable fields', async () => {
  await popup.waitForSelector('#view-result:not([hidden])');
  assert.equal(await popup.textContent('#verdict-title'), 'News article detected');
  assert.equal(await popup.inputValue('#f-title'), 'City council approves riverfront park plan after “marathon” session');
  assert.equal(await popup.locator('#f-authors .chip').count(), 2);
  assert.equal(await popup.textContent('#send-label'), 'Send to Glide');
});

if (SHOTS) {
  await popup.waitForFunction(() => document.getElementById('preview-img').complete);
  await popup.waitForTimeout(900);
  await popup.screenshot({ path: path.join(ROOT, 'docs', 'popup.png') });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(ROOT, 'docs', 'popup-dark.png') });
  await popup.emulateMedia({ colorScheme: 'light' });
}

await test('JSON tab shows exactly the webhook schema', async () => {
  await popup.click('#tab-json');
  const json = JSON.parse(await popup.textContent('#json-view'));
  assert.deepEqual(Object.keys(json), ['url', 'title', 'image', 'published_date', 'authors']);
  if (SHOTS) {
    await popup.evaluate(() => { document.getElementById('main').scrollTop = 1e4; });
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(ROOT, 'docs', 'popup-json.png') });
  }
  await popup.click('#tab-fields');
  if (SHOTS) {
    await popup.evaluate(() => { document.getElementById('main').scrollTop = 1e4; });
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: path.join(ROOT, 'docs', 'popup-fields.png') });
    await popup.evaluate(() => { document.getElementById('main').scrollTop = 0; });
  }
});

await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), LOCAL_HOOK);

await test('editing a field and pressing Send POSTs the edited JSON', async () => {
  await popup.fill('#f-author-input', 'Pat Lee');
  await popup.press('#f-author-input', 'Enter');
  assert.equal(await storedWebhook(), LOCAL_HOOK);
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="sent"]', { timeout: 8000 });
  assert.equal(received.length, 1);
  assert.match(received[0].headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(received[0].body), {
    url: `${SITE}/2026/11/08/city-council-approves-riverfront-park-plan/?id=42`,
    title: 'City council approves riverfront park plan after “marathon” session',
    image: `${SITE}/media/riverfront-park.jpg`,
    published_date: '2026-11-08T19:30:00.000Z',
    authors: ['María José Álvarez', 'John E. Smith', 'Pat Lee'],
  });
});

await test('badge switches to "sent" and the popup remembers it', async () => {
  assert.equal(await waitFor(async () => (await badge()) === '↑' && '↑'), '↑');
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  assert.equal(await popup.textContent('#send-label'), 'Send again');
  assert.match(await popup.textContent('#footer-note'), /Already sent/);
});

await test('a failing webhook shows an error instead of "sent"', async () => {
  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), `${ORIGIN}/nope`);
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="error"]', { timeout: 8000 });
  assert.match(await popup.textContent('#footer-note'), /Network error|responded 404/);
  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), `${ORIGIN}/hook`);
});

await test('posting straight to a token-protected Glide trigger shows Glide\'s 401 reason', async () => {
  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), `${ORIGIN}/secure-hook`);
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="error"]', { timeout: 8000 });
  assert.equal(await popup.textContent('#footer-note'), 'Webhook responded 401 — Invalid bearer token');
});

const relay = await startRelay({ env: { GLIDE_WEBHOOK_URL: `${ORIGIN}/secure-hook`, GLIDE_TOKEN: SECURE_TOKEN } });
const RELAY_URL = `http://127.0.0.1:${relay.address().port}/`;

await test('through the relay, Glide receives the clip with the token the extension never sees', async () => {
  const before = received.length;
  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), RELAY_URL);
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="sent"]', { timeout: 8000 });
  assert.equal(received.length, before + 1);
  assert.equal(received.at(-1).path, '/secure-hook');
  assert.equal(received.at(-1).headers.authorization, `Bearer ${SECURE_TOKEN}`);
  assert.deepEqual(JSON.parse(received.at(-1).body), {
    url: `${SITE}/2026/11/08/city-council-approves-riverfront-park-plan/?id=42`,
    title: 'City council approves riverfront park plan after \u201cmarathon\u201d session',
    image: `${SITE}/media/riverfront-park.jpg`,
    published_date: '2026-11-08T19:30:00.000Z',
    authors: ['Mar\u00eda Jos\u00e9 \u00c1lvarez', 'John E. Smith'],
  });
  // Nothing the extension stores or shows contains the token.
  const everything = await worker.evaluate(async () => JSON.stringify([await chrome.storage.sync.get(null), await chrome.storage.local.get(null)]));
  assert.ok(!everything.includes(SECURE_TOKEN));
  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/src/options/options.html`);
  assert.equal(await opts.locator('#token').count(), 0);
  assert.ok(!(await opts.content()).includes(SECURE_TOKEN));
  await opts.close();
});

await test('a relay with a stale token explains how to fix it', async () => {
  const stale = await startRelay({ env: { GLIDE_WEBHOOK_URL: `${ORIGIN}/secure-hook`, GLIDE_TOKEN: 'old-token' } });
  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), `http://127.0.0.1:${stale.address().port}/`);
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="error"]', { timeout: 8000 });
  assert.match(await popup.textContent('#footer-note'), /Glide rejected the relay’s bearer token\. Update GLIDE_TOKEN/);
  stale.close();
  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), `${ORIGIN}/hook`);
});

await test('non-article page gets no badge and a quiet "Send anyway" button', async () => {
  const home = await ctx.newPage();
  await home.goto(`${SITE}/`);
  const homeTab = await newestTabId();
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), homeTab), '');
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 384, height: 600 });
  await p.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${homeTab}`);
  await p.waitForSelector('#view-result:not([hidden])');
  assert.equal(await p.textContent('#verdict-title'), "Doesn't look like an article");
  assert.equal(await p.textContent('#send-label'), 'Send anyway');
  await p.close();
  await home.close();
});

await test('auto-send posts once per article when enabled', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({ autoSend: true, autoSendThreshold: 55 }));
  const before = received.length;
  const p = await ctx.newPage();
  await p.goto(`${SITE}/science/researchers-map-deep-sea-vents`);
  await waitFor(() => received.length > before, 6000);
  await p.reload();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(received.length, before + 1);
  assert.equal(JSON.parse(received.at(-1).body).title, 'Researchers map deep-sea vents');
  await worker.evaluate(() => chrome.storage.sync.set({ autoSend: false, autoSendThreshold: 70 }));
  await p.close();
});

await test('options page lists the history', async () => {
  const opts = await ctx.newPage();
  await opts.setViewportSize({ width: 900, height: 1100 });
  await opts.goto(`chrome-extension://${extId}/src/options/options.html`);
  await opts.waitForSelector('.history li');
  assert.ok(await opts.locator('.history li').count() >= 3);
  if (SHOTS) {
    await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), GLIDE);
    await opts.reload();
    await opts.waitForSelector('.history li');
    await opts.waitForTimeout(500);
    await opts.screenshot({ path: path.join(ROOT, 'docs', 'options.png'), fullPage: true });
  }
  await opts.close();
});

await ctx.close();
relay.close();

// ---------------------------------------------------------------------------
// 4. Upgrade from v1.1 (Glide URL + token stored) to a relay build
// ---------------------------------------------------------------------------

console.log('\nUpgrade');
await test('updating replaces a stored Glide URL with the relay default and deletes any saved token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meditor-upgrade-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'meditor-profile-'));
  fs.cpSync(EXT, dir, { recursive: true });
  const launch = () => chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  const swOf = async (c) => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  try {
    // 1. A v1.1 user: the Glide URL in sync storage and a token in local storage.
    let browserCtx = await launch();
    let sw = await swOf(browserCtx);
    await sw.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 300)); // let onInstalled seeding finish first
      await chrome.storage.sync.set({ webhookUrl: 'https://go.glideapps.com/api/container/plugin/webhook-trigger/APP/TRIGGER', autoSend: false });
      await chrome.storage.local.set({ webhookToken: 'old-token' });
    });
    await browserCtx.close();

    // 2. They unzip the relay build over the same folder (new default, new version) and restart.
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ webhookUrl: 'https://meditor-relay.example.workers.dev/' }));
    const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    mf.version = '9.9.9';
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf, null, 2));

    browserCtx = await launch();
    sw = await swOf(browserCtx);
    const state = await waitFor(async () => {
      const s = await sw.evaluate(async () => ({ sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get(null) })).catch(() => null);
      return s && !('webhookToken' in s.local) && !('webhookUrl' in s.sync) ? s : null;
    }, 8000);
    assert.ok(state, 'storage was not migrated');
    assert.equal(state.sync.autoSend, false);
    const p = await browserCtx.newPage();
    await p.goto(`chrome-extension://${new URL(sw.url()).host}/src/options/options.html`);
    assert.equal(await p.inputValue('#webhook'), 'https://meditor-relay.example.workers.dev/');
    await browserCtx.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

server.close();

console.log(failures ? `\n${failures} test(s) failed\n` : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
