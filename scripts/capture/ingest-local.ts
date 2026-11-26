/// <reference types="node" />
/**
 * npm run capture:ingest
 *
 * Loads .data/captures (from `npm run capture`) into the LOCAL dev bindings: objects into the
 * local R2 bucket, rows into the local D1 through ingestCapture(), then rebuilds derived
 * tables. Safe to re-run (unchanged captures are skipped); run it again after `npm run setup`,
 * which recreates the local D1 with placeholders only. Nothing remote is touched.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ogKey, topThumbKey } from '../../src/lib/media.ts';
import { isCaptureBlocked } from '../../src/server/repo/capture.ts';
import { ingestCapture } from '../../src/server/repo/ingest.ts';
import { rebuildDerived } from '../../src/server/repo/maintenance.ts';
import { openLocalEnv } from './local-env.ts';
import { readManifest } from './manifest.ts';
import { ogCrop, topThumb } from './process.ts';
import { MANIFEST, objectPath } from './paths.ts';

if (!existsSync(MANIFEST)) {
  console.error('No .data/captures/manifest.json yet. Run `npm run capture` first.');
  process.exit(1);
}
const manifest = readManifest();
const local = await openLocalEnv();
const counts: Record<string, number> = {};
try {
  for (const { capture } of manifest.entries) {
    // Contract step 3: never store anything for a blocked domain.
    if (await isCaptureBlocked(local.db, capture.domain)) {
      counts.blocked = (counts.blocked ?? 0) + 1;
      continue;
    }
    // Captures from before thumbnails existed get their top thumbnail cut now.
    const thumb = topThumbKey(capture.r2_key);
    if (existsSync(objectPath(capture.r2_key)) && !existsSync(objectPath(thumb)))
      writeFileSync(
        objectPath(thumb),
        await topThumb(readFileSync(objectPath(capture.r2_key)), capture.device, capture.width),
      );
    const og = ogKey(capture.r2_key);
    if (capture.device === 'desktop' && existsSync(objectPath(capture.r2_key))) {
      if (!existsSync(objectPath(og)))
        writeFileSync(objectPath(og), await ogCrop(readFileSync(objectPath(capture.r2_key)), capture.width));
      if (!(await local.media.head(og)))
        await local.media.put(og, readFileSync(objectPath(og)), {
          httpMetadata: { contentType: 'image/jpeg' },
        });
    }
    const keys = [capture.r2_key, thumb, ...capture.sections.flatMap((s) => s.r2_key_crop ?? [])];
    const missing = keys.filter((k) => !existsSync(objectPath(k)));
    if (missing.length) {
      console.warn(
        `  skip ${capture.domain} ${capture.device}: ${missing.length} object(s) missing`,
      );
      counts.missing = (counts.missing ?? 0) + 1;
      continue;
    }
    for (const key of keys) {
      if (await local.media.head(key)) continue;
      await local.media.put(key, readFileSync(objectPath(key)), {
        httpMetadata: { contentType: 'image/webp' },
      });
    }
    const res = await ingestCapture(local.db, capture);
    counts[res.status] = (counts[res.status] ?? 0) + 1;
    console.log(
      `  ${res.status.padEnd(9)} ${capture.domain} ${capture.page_type} ${capture.device}`,
    );
  }
  await rebuildDerived(local.db);
} finally {
  await local.dispose();
}
console.log(
  `Done: ${Object.entries(counts)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')}. Restart \`astro dev\` if it was running.`,
);
