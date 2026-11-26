/// <reference types="node" />
/**
 * npm run capture [-- --only youngla.com,thesill.com] [--pages home,collection,product,cart]
 *                 [--devices desktop,mobile] [--limit 5] [--stitch]
 *
 * Captures the curated stores (desktop 1440 px and mobile 390 px) into .data/captures/: WebP
 * objects laid out like the R2 bucket plus manifest.json. Collection and product pages are
 * discovered from the home page's links; the cart page is captured with one item in it.
 * Nothing is uploaded anywhere; `npm run capture:ingest` loads the result into the LOCAL D1 +
 * R2. Per-store settings (stitched capture) live in data/curation/capture.json.
 *
 * Follows the capture-block contract (docs/ARCHITECTURE.md): the work list comes from
 * listCaptureTargets() and each store is re-checked with isCaptureBlocked() right before it is
 * captured. Run `npm run setup` once first so the local D1 exists.
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isCaptureBlocked, listCaptureTargets } from '../../src/server/repo/capture.ts';
import {
  CaptureError,
  capturePage,
  discoverPages,
  type CaptureDevice,
  type CapturePageType,
} from './browser.ts';
import { robotsFor } from '../crawl/robots.ts';
import { openLocalEnv } from './local-env.ts';
import { readManifest, upsertEntry, writeManifest } from './manifest.ts';
import { ROOT } from './paths.ts';
import { processCapture } from './process.ts';

// No cart: it needs POST /cart/add.js, which Shopify's robots.txt disallows.
const PAGE_TYPES: CapturePageType[] = ['home', 'collection', 'product'];
const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    pages: { type: 'string', default: PAGE_TYPES.join(',') },
    devices: { type: 'string', default: 'desktop,mobile' },
    limit: { type: 'string' },
    stitch: { type: 'boolean', default: false },
    /** Skip pages already captured with the current rules (manifest entries with `raw`). */
    resume: { type: 'boolean', default: false },
    /** With --resume: only skip captures taken after this ISO date. */
    since: { type: 'string' },
  },
});
const list = (v: string) => v.split(',').map((d) => d.trim());
const only = values.only ? new Set(list(values.only)) : null;
const devices = list(values.devices) as CaptureDevice[];
const pages = list(values.pages) as CapturePageType[];
for (const d of devices) if (d !== 'desktop' && d !== 'mobile') throw new Error(`device ${d}?`);
for (const p of pages) if (!PAGE_TYPES.includes(p)) throw new Error(`page ${p}?`);
const settings = JSON.parse(readFileSync(join(ROOT, 'data/curation/capture.json'), 'utf8')) as {
  stitch: string[];
};
const stitchSet = new Set(settings.stitch);

const local = await openLocalEnv();
let browser = await chromium.launch();
/** Chromium can crash on very long pages; relaunch instead of failing every later store. */
const liveBrowser = async () => {
  if (!browser.isConnected()) {
    console.log('  (browser crashed; relaunching)');
    await browser.close().catch(() => undefined);
    browser = await chromium.launch();
  }
  return browser;
};
let manifest = readManifest();
let ok = 0;
let failed = 0;
/** A stuck page must not stall the run. */
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s`)), ms),
    ),
  ]);
const fail = (domain: string, page: string, device: string, reason: string) => {
  failed += 1;
  manifest.failures = [
    ...manifest.failures.filter(
      (f) => !(f.domain === domain && (f.page_type ?? 'home') === page && f.device === device),
    ),
    { domain, page_type: page, device, reason: reason.slice(0, 300), at: new Date().toISOString() },
  ];
  writeManifest(manifest);
  console.log(`  FAIL ${domain} ${page} ${device}: ${reason.split('\n')[0]}`);
};
try {
  const { items } = await listCaptureTargets(local.db, { scope: 'curated', limit: 500 });
  let targets = only ? items.filter((t) => only.has(t.domain)) : items;
  if (values.limit) targets = targets.slice(0, Number(values.limit));
  if (only && targets.length < only.size)
    console.warn('Some --only domains are not capture targets (not curated, blocked or unknown).');
  console.log(`Capturing ${targets.length} store(s): ${pages.join('+')} × ${devices.join('+')}`);

  for (const t of targets) {
    if (await isCaptureBlocked(local.db, t.domain)) {
      console.log(`  skip ${t.domain}: capture blocked`);
      continue;
    }
    const apps = await local.db.all<{ slug: string }>(
      `SELECT a.slug FROM store_apps sa JOIN apps a ON a.id = sa.app_id
       JOIN stores s ON s.id = sa.store_id WHERE s.domain = ? AND sa.removed_at IS NULL`,
      [t.domain],
    );
    const done = (pageType: string, device: string) =>
      values.resume &&
      manifest.entries.some(
        (e) =>
          e.raw &&
          e.capture.domain === t.domain &&
          e.capture.page_type === pageType &&
          e.capture.device === device &&
          (!values.since || e.capture.captured_at >= values.since),
      );
    if (pages.every((p) => devices.every((d) => done(p, d)))) {
      console.log(`  done ${t.domain}: already captured`);
      continue;
    }
    const needsDiscovery = pages.some((p) => p !== 'home');
    const found = needsDiscovery
      ? await discoverPages(await liveBrowser(), t.url).catch(() => ({
          collection: null,
          product: null,
        }))
      : { collection: null, product: null };
    const urls: Record<CapturePageType, string | null> = {
      home: t.url,
      collection: found.collection,
      product: found.product,
      cart: found.product ? new URL('/cart', found.product).href : null,
    };
    for (const pageType of pages) {
      const url = urls[pageType];
      for (const device of devices) {
        if (done(pageType, device)) continue;
        if (!url) {
          fail(t.domain, pageType, device, `no ${pageType} page found from the home page`);
          continue;
        }
        const target = new URL(url);
        if (!(await robotsFor(target.hostname)).allows(target.pathname + target.search)) {
          fail(t.domain, pageType, device, `robots.txt disallows ${target.pathname}`);
          continue;
        }
        const started = Date.now();
        try {
          const shoot = async () =>
            withTimeout(
              capturePage(await liveBrowser(), url, device, {
                pageType,
                stitch: values.stitch || stitchSet.has(t.domain),
                productUrl: found.product,
              }),
              240_000,
            );
          // One retry for transient browser errors (a redirect mid-script, a slow first load);
          // CaptureErrors (bot check, password page, not Shopify…) are final.
          const capture = await shoot().catch((e: unknown) => {
            if (e instanceof CaptureError) throw e;
            console.log(`  retry ${t.domain} ${pageType} ${device}: ${String(e).split('\n')[0]}`);
            return shoot();
          });
          const entry = await processCapture({
            domain: t.domain,
            device,
            pageType,
            capture,
            capturedAt: new Date().toISOString(),
            storeApps: apps.map((a) => a.slug),
          });
          manifest = upsertEntry(manifest, entry);
          writeManifest(manifest);
          ok += 1;
          const c = entry.capture;
          console.log(
            `  ok   ${t.domain} ${pageType} ${device}: ${c.width}×${c.height}${entry.diagnostics.truncated ? ` (cut from ${entry.diagnostics.full_height})` : ''}${capture.tiles ? ' stitched' : ''}, ` +
              `${c.sections.length}/${entry.diagnostics.dom_sections} sections, ${((c.bytes ?? 0) / 1024).toFixed(0)} KB, ${((Date.now() - started) / 1000).toFixed(1)} s`,
          );
        } catch (e) {
          fail(
            t.domain,
            pageType,
            device,
            e instanceof CaptureError ? `${e.reason}: ${e.message}` : String(e),
          );
        }
      }
    }
  }
} finally {
  await browser.close();
  await local.dispose();
}
console.log(`Done: ${ok} captured, ${failed} failed. Next: npm run capture:ingest`);
