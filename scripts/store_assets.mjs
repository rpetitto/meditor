// Build the Chrome Web Store images from the screenshots `npm run screenshots` captures.
//
//   npm run screenshots && npm run store-assets
//
// Writes store/screenshot-{1..5}.png (1280x800), store/promo-small.png (440x280),
// store/promo-marquee.png (1400x560) and docs/popup-tour.png.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'store', 'raw');
const OUT = path.join(ROOT, 'store');

const need = ['popup-main.png', 'popup-fields.png', 'popup-json.png', 'popup-dark.png', 'options-1280.png'];
for (const f of need) {
  if (!fs.existsSync(path.join(RAW, f))) {
    console.error(`Missing store/raw/${f}. Run "npm run screenshots" first.`);
    process.exit(1);
  }
}
const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(RAW, f)).toString('base64')}`;
const icon = `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg')).toString('base64')}`;

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: Inter, system-ui, sans-serif; color: #fff; overflow: hidden;
    background:
      radial-gradient(60% 80% at 85% 10%, rgba(150,190,230,.32), transparent 60%),
      radial-gradient(50% 70% at 0% 100%, rgba(150,190,230,.14), transparent 60%),
      linear-gradient(135deg, #234a8c 0%, #13294f 70%, #0d1d3a 100%);
  }
  .serif { font-family: Charter, "Bitstream Charter", Georgia, serif; }
  .eyebrow { display: flex; align-items: center; gap: 12px; color: #96bee6; font-weight: 700; letter-spacing: .4px; font-size: 17px; }
  .eyebrow img { width: 34px; height: 34px; }
  .shot { border-radius: 18px; box-shadow: 0 40px 80px -30px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.08); }
`;

const screenshot = (title, sub, file, bullets = []) => `<!doctype html><html><head><style>${BASE_CSS}
  .wrap { display: grid; grid-template-columns: 1fr 440px; align-items: center; gap: 56px; height: 100%; padding: 0 96px 0 104px; }
  h1 { font-size: 52px; line-height: 1.08; letter-spacing: -.5px; margin: 26px 0 18px; font-weight: 700; }
  p { font-size: 21px; line-height: 1.5; color: rgba(255,255,255,.78); max-width: 520px; }
  ul { list-style: none; padding: 0; margin-top: 28px; display: grid; gap: 12px; }
  li { display: flex; gap: 12px; align-items: baseline; font-size: 18px; color: rgba(255,255,255,.88); }
  li::before { content: "✓"; color: #96bee6; font-weight: 800; }
  .shot { width: 440px; height: 688px; display: block; }
</style></head><body><div class="wrap">
  <div>
    <div class="eyebrow"><img src="${icon}">mEditor · News Clipper</div>
    <h1 class="serif">${title}</h1>
    <p>${sub}</p>
    ${bullets.length ? `<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : ''}
  </div>
  <img class="shot" src="${img(file)}">
</div></body></html>`;

const pages = [
  {
    out: 'screenshot-1.png', w: 1280, h: 800,
    html: screenshot('Spot a news article.<br>Clip it in one click.',
      'mEditor reads the article you’re on and pulls out exactly what your Glide app needs.',
      'popup-main.png', ['Headline, link and lead image', 'Publish date and every author', 'Confidence score you can inspect']),
  },
  {
    out: 'screenshot-2.png', w: 1280, h: 800,
    html: screenshot('Check every field<br>before it’s sent.',
      'Fix a headline, swap the image, add or remove an author. The preview and payload update as you type.',
      'popup-fields.png'),
  },
  {
    out: 'screenshot-3.png', w: 1280, h: 800,
    html: screenshot('Exactly the JSON<br>your app expects.',
      'Every clip is the same five fields: url, title, image, published_date and authors. Clean URLs and ISO dates, ready for your Glide workflow.',
      'popup-json.png'),
  },
  {
    out: 'screenshot-4.png', w: 1280, h: 800,
    html: `<!doctype html><html><head><style>${BASE_CSS} body{background:#f3f5f9}</style></head><body><img src="${img('options-1280.png')}" style="display:block;width:1280px;height:800px"></body></html>`,
  },
  {
    out: 'screenshot-5.png', w: 1280, h: 800,
    html: screenshot('Private by default.',
      'mEditor reads a page only when you click its icon, unless you switch on automatic detection. Nothing is sent until you press Send.',
      'popup-dark.png', ['No access to your sites until you ask', 'No tracking, no analytics', 'Light and dark themes']),
  },
  {
    out: 'promo-small.png', w: 440, h: 280,
    html: `<!doctype html><html><head><style>${BASE_CSS}
      .t { height: 100%; display: flex; align-items: center; gap: 22px; padding: 0 34px; }
      .t img { width: 104px; height: 104px; filter: drop-shadow(0 10px 18px rgba(0,0,0,.35)); }
      h1 { font-size: 40px; letter-spacing: -.3px; }
      p { margin-top: 6px; font-size: 16.5px; line-height: 1.35; color: #c9dcf2; }
    </style></head><body><div class="t"><img src="${icon}"><div><h1 class="serif">mEditor</h1><p>Clip news articles to your Glide app in one click.</p></div></div></body></html>`,
  },
  {
    out: 'promo-marquee.png', w: 1400, h: 560,
    html: `<!doctype html><html><head><style>${BASE_CSS}
      .m { height: 100%; display: grid; grid-template-columns: 1fr 520px; align-items: center; padding: 0 0 0 110px; }
      .m img.i { width: 120px; height: 120px; filter: drop-shadow(0 12px 22px rgba(0,0,0,.35)); }
      h1 { font-size: 64px; margin-top: 22px; letter-spacing: -.6px; }
      p { margin-top: 12px; font-size: 24px; color: #c9dcf2; max-width: 560px; line-height: 1.4; }
      .crop { height: 560px; overflow: hidden; padding-top: 70px; }
      .crop img { width: 440px; display: block; }
    </style></head><body><div class="m">
      <div><img class="i" src="${icon}"><h1 class="serif">mEditor</h1><p>Spot news articles and clip them to your Glide app in one click.</p></div>
      <div class="crop"><img class="shot" src="${img('popup-main.png')}"></div>
    </div></body></html>`,
  },
  {
    out: path.join('..', 'docs', 'popup-tour.png'), w: 1664, h: 664, scale: 1,
    html: `<!doctype html><html><head><style>${BASE_CSS}
      body { background: #e2e8f2; }
      .row { display: flex; gap: 16px; padding: 16px; }
      .row img { width: 400px; height: 625px; border-radius: 14px; box-shadow: 0 10px 30px -12px rgba(14,26,46,.35); }
    </style></head><body><div class="row">
      ${['popup-main.png', 'popup-fields.png', 'popup-json.png', 'popup-dark.png'].map((f) => `<img src="${img(f)}">`).join('')}
    </div></body></html>`,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const p of pages) {
  await page.setViewportSize({ width: p.w, height: p.h });
  await page.setContent(p.html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(OUT, p.out);
  await page.screenshot({ path: file });
  console.log(`wrote ${path.relative(ROOT, file)} (${p.w}x${p.h})`);
}
await browser.close();
