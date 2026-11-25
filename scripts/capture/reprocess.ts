/// <reference types="node" />
/**
 * npm run capture:reprocess [-- --only youngla.com]
 *
 * Re-runs section detection on captures already taken, without a browser: reads the raw DOM
 * sections stored in the manifest (`raw`, written since #15), classifies them with the current
 * rules and re-cuts the crops from the saved full-page WebP. Use it after changing
 * scripts/capture/classify.ts, then `npm run capture:ingest` (ingest replaces the sections of
 * a capture whose sections changed). Entries without `raw` (older captures) are skipped: run
 * `npm run capture` for those stores.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openLocalEnv } from './local-env.ts';
import { readManifest, writeManifest } from './manifest.ts';
import { objectPath } from './paths.ts';
import { cropSections, detectSections } from './process.ts';

const { values } = parseArgs({ options: { only: { type: 'string' } } });
const only = values.only ? new Set(values.only.split(',').map((d) => d.trim())) : null;

const local = await openLocalEnv();
const manifest = readManifest();
let done = 0;
let skipped = 0;
let before = 0;
let after = 0;
try {
  for (const entry of manifest.entries) {
    const c = entry.capture;
    if (only && !only.has(c.domain)) continue;
    if (!entry.raw) {
      skipped += 1;
      continue;
    }
    const apps = await local.db.all<{ slug: string }>(
      `SELECT a.slug FROM store_apps sa JOIN apps a ON a.id = sa.app_id
       JOIN stores s ON s.id = sa.store_id WHERE s.domain = ? AND sa.removed_at IS NULL`,
      [c.domain],
    );
    const page = c.page_type as Parameters<typeof detectSections>[2];
    const { sections, unclassified } = detectSections(
      { sections: entry.raw.sections, height: c.height, width: c.width },
      apps.map((a) => a.slug),
      page,
    );
    before += entry.diagnostics.unclassified.length;
    after += unclassified.length;
    c.sections = await cropSections({
      domain: c.domain,
      device: c.device as 'desktop' | 'mobile',
      page: page ?? 'home',
      capturedAt: c.captured_at,
      image: readFileSync(objectPath(c.r2_key)),
      sections,
      stitched: c.sections.some((s) => s.hints?.capture === 'stitched'),
      cssWidth: c.width,
    });
    entry.diagnostics.unclassified = unclassified;
    done += 1;
  }
} finally {
  writeManifest(manifest);
  await local.dispose();
}
console.log(
  `Reprocessed ${done} capture(s), skipped ${skipped} without raw sections. ` +
    `Unclassified: ${before} → ${after}. Next: npm run capture:ingest`,
);
