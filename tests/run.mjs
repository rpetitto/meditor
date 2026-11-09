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
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
  // /hook accepts anything; /secure-hook behaves like a Glide trigger with a bearer token.
  if (url.pathname === '/hook' || url.pathname === '/secure-hook') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (url.pathname === '/secure-hook' && req.headers.authorization !== `Bearer ${SECURE_TOKEN}`) {
        return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"Unauthorized"}');
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
// 2. Extension end to end
// ---------------------------------------------------------------------------

console.log('\nExtension');
// For screenshots, serve the fixture site under a realistic host name instead of 127.0.0.1:port.
const SITE = SHOTS ? 'http://www.dailyledger.test' : ORIGIN;
// A placeholder Glide URL for screenshots. The real webhook is never used by the tests.
const GLIDE = 'https://go.glideapps.com/api/container/plugin/webhook-trigger/YOUR_APP_ID/YOUR_TRIGGER_ID';
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
      if ('webhookUrl' in s) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    return chrome.storage.sync.get(null);
  });
  // The unpackaged source ships without a webhook (it's a secret); package.sh bakes one in.
  assert.equal(settings.webhookUrl, '');
  assert.equal(settings.autoSend, false);
  assert.equal(settings.autoSendThreshold, 70);
});

await test('first install without a webhook opens Settings', async () => {
  const isOptions = (p) => p.url().includes('/src/options/options.html');
  const opts = ctx.pages().find(isOptions) || await ctx.waitForEvent('page', { predicate: isOptions, timeout: 5000 });
  await opts.waitForSelector('#webhook-status.bad');
  assert.match(await opts.textContent('#webhook-status'), /Paste your Glide webhook URL/);
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

await test('a webhook that needs a bearer token reports the 401 and links to Settings', async () => {
  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), `${ORIGIN}/secure-hook`);
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="error"]', { timeout: 8000 });
  assert.match(await popup.textContent('#footer-note'), /requires a bearer token \(HTTP 401\)/);
  assert.equal(await popup.textContent('#footer-note .footer__fix'), 'Open Settings');
});

await test('a wrong bearer token is reported as rejected', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ webhookToken: 'not-the-token' }));
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="error"]', { timeout: 8000 });
  assert.match(await popup.textContent('#footer-note'), /rejected the bearer token/);
});

await test('the bearer token from Settings is sent as an Authorization header', async () => {
  const before = received.length;
  // Saved as pasted from Glide, "Bearer " prefix included; Meditor normalizes it.
  await worker.evaluate((t) => chrome.storage.local.set({ webhookToken: `Bearer ${t}` }), SECURE_TOKEN);
  await popup.reload();
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.click('#send');
  await popup.waitForSelector('#send[data-state="sent"]', { timeout: 8000 });
  assert.equal(received.length, before + 1);
  assert.equal(received.at(-1).path, '/secure-hook');
  assert.equal(received.at(-1).headers.authorization, `Bearer ${SECURE_TOKEN}`);
  assert.deepEqual(Object.keys(JSON.parse(received.at(-1).body)), ['url', 'title', 'image', 'published_date', 'authors']);

  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/src/options/options.html`);
  assert.equal(await opts.inputValue('#token'), SECURE_TOKEN);
  assert.equal(await opts.getAttribute('#token', 'type'), 'password');
  await opts.click('#token-toggle');
  assert.equal(await opts.getAttribute('#token', 'type'), 'text');
  await opts.close();

  // The token must stay out of synced storage and out of the clip history.
  const leaked = await worker.evaluate(async () => JSON.stringify([await chrome.storage.sync.get(null), await chrome.storage.local.get('history')]));
  assert.ok(!leaked.includes(SECURE_TOKEN));

  await worker.evaluate((url) => chrome.storage.sync.set({ webhookUrl: url }), `${ORIGIN}/hook`);
  await worker.evaluate(() => chrome.storage.local.set({ webhookToken: '' }));
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
server.close();

console.log(failures ? `\n${failures} test(s) failed\n` : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
