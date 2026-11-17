#!/usr/bin/env node
/**
 * Full-page screenshots of routes at 390px and 1440px, for PR descriptions and design review.
 *   node scripts/capture-screens.mjs --base http://127.0.0.1:4321 --out .data/screenshots / /themes /apps
 * Third-party images are stubbed so captures are deterministic. Output: <out>/<slug>--<width>.jpg
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const base = opt('base', 'http://127.0.0.1:4321');
const out = opt('out', '.data/screenshots');
const widths = opt('widths', '390,1440').split(',').map(Number);
const routes = args.length ? args : ['/'];
mkdirSync(out, { recursive: true });

const slug = (route) =>
  route
    .replace(/^\/$/, 'home')
    .replace(/^\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+$/, '') || 'home';
const browser = await chromium.launch();
for (const width of widths) {
  const page = await browser.newPage({
    viewport: { width, height: width < 600 ? 844 : 900 },
    deviceScaleFactor: width < 600 ? 2 : 1,
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) =>
    r.request().resourceType() === 'image' ? r.fulfill({ status: 404 }) : r.abort(),
  );
  for (const route of routes) {
    const res = await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const file = join(out, `${slug(route)}--${width}.jpg`);
    await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 78 });
    console.log(`${res?.status()} ${width} ${route} → ${file}`);
  }
  await page.close();
}
await browser.close();
