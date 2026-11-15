// Rasterizes the hand-built SVG icons. Dev-only: needs Playwright + Chromium (same setup as the UI smokes).
// Run: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs [CHROMIUM_PATH=…] node cloudflare/scripts/generate-icons.mjs
// Sources: public/icons/icon.svg (rounded "any" icon, also the SVG favicon), icon-src/full.svg (full-bleed, for iOS),
// icon-src/maskable.svg (full-bleed, content inside the 80% maskable safe zone). The "a" is the Practice Reader Bold glyph.
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const at = path => new URL(path, import.meta.url);
const jobs = [
  ['../public/icons/icon.svg', 'icon-192.png', 192], ['../public/icons/icon.svg', 'icon-512.png', 512],
  ['icon-src/full.svg', 'icon-180.png', 180],
  ['icon-src/maskable.svg', 'icon-maskable-192.png', 192], ['icon-src/maskable.svg', 'icon-maskable-512.png', 512],
];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const [source, name, size] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const svg = (await readFile(at(source))).toString('base64');
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" style="display:block">`);
    await page.locator('img').evaluate(img => img.decode());
    await page.screenshot({ path: at('../public/icons/' + name).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
} finally { await browser.close(); }
