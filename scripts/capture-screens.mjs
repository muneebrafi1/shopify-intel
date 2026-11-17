#!/usr/bin/env node
/**
 * Full-page screenshots of routes at 390px and 1440px, for PR descriptions and design review.
 *   node scripts/capture-screens.mjs --base http://127.0.0.1:4321 --out .data/screenshots / /themes /apps
 *   node scripts/capture-screens.mjs --theme dark / /pro
 * Options:
 *   --base    server origin (default http://127.0.0.1:4321)
 *   --out     output folder (default .data/screenshots)
 *   --widths  comma-separated viewport widths (default 390,1440)
 *   --theme   light | dark | system (default: none stored, i.e. the light default). Stores the
 *             choice in localStorage['theme'] before any page script runs, exactly like the
 *             header toggle does, and emulates the matching prefers-color-scheme.
 * Third-party images are stubbed so captures are deterministic.
 * Output: <out>/<slug>--<width>.jpg, or <slug>--<width>--<theme>.jpg when --theme is given.
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
const theme = opt('theme', '');
if (theme && !['light', 'dark', 'system'].includes(theme)) {
  console.error(`--theme must be light, dark or system (got "${theme}")`);
  process.exit(1);
}
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
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  if (theme) {
    // Runs before the inline <head> script, so the first paint is already in this theme.
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('theme', value);
      } catch {
        /* storage blocked: the emulated colour scheme still applies */
      }
    }, theme);
  }
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
    const suffix = theme ? `--${theme}` : '';
    const file = join(out, `${slug(route)}--${width}${suffix}.jpg`);
    await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 78 });
    console.log(`${res?.status()} ${width} ${route}${theme ? ` (${theme})` : ''} → ${file}`);
  }
  await page.close();
}
await browser.close();
