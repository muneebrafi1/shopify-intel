/// <reference types="node" />
/**
 * npm run capture [-- --only youngla.com,thesill.com] [--devices desktop,mobile] [--limit 5]
 *
 * Captures the home page of the curated stores (desktop 1440 px and mobile 390 px) into
 * .data/captures/: WebP objects laid out like the R2 bucket plus manifest.json. Nothing is
 * uploaded anywhere; `npm run capture:ingest` loads the result into the LOCAL D1 + R2.
 *
 * Follows the capture-block contract (docs/ARCHITECTURE.md): the work list comes from
 * listCaptureTargets() and each store is re-checked with isCaptureBlocked() right before it is
 * captured. Run `npm run setup` once first so the local D1 exists.
 */
import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';
import { isCaptureBlocked, listCaptureTargets } from '../../src/server/repo/capture.ts';
import { CaptureError, capturePage, type CaptureDevice } from './browser.ts';
import { openLocalEnv } from './local-env.ts';
import { readManifest, upsertEntry, writeManifest } from './manifest.ts';
import { processCapture } from './process.ts';

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    devices: { type: 'string', default: 'desktop,mobile' },
    limit: { type: 'string' },
  },
});
const only = values.only ? new Set(values.only.split(',').map((d) => d.trim())) : null;
const devices = values.devices.split(',').map((d) => d.trim()) as CaptureDevice[];
for (const d of devices) if (d !== 'desktop' && d !== 'mobile') throw new Error(`device ${d}?`);

const local = await openLocalEnv();
const browser = await chromium.launch();
let manifest = readManifest();
let ok = 0;
let failed = 0;
try {
  const { items } = await listCaptureTargets(local.db, { scope: 'curated', limit: 500 });
  let targets = only ? items.filter((t) => only.has(t.domain)) : items;
  if (values.limit) targets = targets.slice(0, Number(values.limit));
  if (only && targets.length < only.size)
    console.warn('Some --only domains are not capture targets (not curated, blocked or unknown).');
  console.log(`Capturing ${targets.length} store(s) × ${devices.join('+')}`);

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
    for (const device of devices) {
      const started = Date.now();
      try {
        const capture = await capturePage(browser, t.url, device);
        const entry = await processCapture({
          domain: t.domain,
          device,
          capture,
          capturedAt: new Date().toISOString(),
          storeApps: apps.map((a) => a.slug),
        });
        manifest = upsertEntry(manifest, entry);
        writeManifest(manifest);
        ok += 1;
        const c = entry.capture;
        console.log(
          `  ok   ${t.domain} ${device}: ${c.width}×${c.height}${entry.diagnostics.truncated ? ` (cut from ${entry.diagnostics.full_height})` : ''}, ` +
            `${c.sections.length}/${entry.diagnostics.dom_sections} sections, ${((c.bytes ?? 0) / 1024).toFixed(0)} KB, ${((Date.now() - started) / 1000).toFixed(1)} s`,
        );
      } catch (e) {
        failed += 1;
        const reason = e instanceof CaptureError ? `${e.reason}: ${e.message}` : String(e);
        manifest.failures = [
          ...manifest.failures.filter((f) => !(f.domain === t.domain && f.device === device)),
          { domain: t.domain, device, reason: reason.slice(0, 300), at: new Date().toISOString() },
        ];
        writeManifest(manifest);
        console.log(`  FAIL ${t.domain} ${device}: ${reason.split('\n')[0]}`);
      }
    }
  }
} finally {
  await browser.close();
  await local.dispose();
}
console.log(`Done: ${ok} captured, ${failed} failed. Next: npm run capture:ingest`);
