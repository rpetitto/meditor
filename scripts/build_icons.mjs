// Render assets/icon.svg into the extension's PNG icons with Chromium.
//
//   node scripts/build_icons.mjs
//
// Toolbar sizes (16/32/48) and logo.png are full-bleed. icon128.png follows the
// Chrome Web Store guideline: 96x96 artwork centred with 16px transparent padding.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
const OUT = path.join(ROOT, 'extension', 'icons');

const targets = [
  { file: 'icon16.png', size: 16, art: 16 },
  { file: 'icon32.png', size: 32, art: 32 },
  { file: 'icon48.png', size: 48, art: 48 },
  { file: 'icon128.png', size: 128, art: 96 },
  { file: 'logo.png', size: 256, art: 256 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, art } of targets) {
  await page.setViewportSize({ width: size, height: size });
  const pad = (size - art) / 2;
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
      <div style="width:${art}px;height:${art}px">${svg.replace('<svg ', `<svg width="${art}" height="${art}" `)}</div>
    </div></body></html>`);
  await page.screenshot({ path: path.join(OUT, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`wrote extension/icons/${file} (${size}px${pad ? `, ${pad}px padding` : ''})`);
}
await browser.close();
