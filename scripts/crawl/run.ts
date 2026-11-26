/// <reference types="node" />
/**
 * npm run crawl -- --domains a.com,b.com      crawl these stores
 * npm run crawl -- --curated                  crawl every curated store in the local D1
 * npm run crawl -- --all [--since ISO]        crawl every active store (resume: skip ones scanned since)
 *
 * Writes .data/crawl/scans.json (one ScanInput per store, plus the storefront country and a note)
 * for `npm run crawl:ingest`. Nothing is sent anywhere by this step. Stores that are blocked
 * from capture or opted out are skipped. See docs/CRAWL.md.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { isCaptureBlocked } from '../../src/server/repo/capture.ts';
import { openLocalEnv } from '../capture/local-env.ts';
import { crawlStore, loadEngine, STOREPEEK_DIR } from './collect.ts';
import { robotsFor } from './robots.ts';

import { SCANS_FILE } from './paths.ts';

const { values } = parseArgs({
  options: {
    domains: { type: 'string' },
    curated: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '3' },
    /** Every store in the local D1 (the whole scan set), not just the curated ones. */
    all: { type: 'boolean', default: false },
    /** Skip stores already in scans.json that were scanned after this ISO date. */
    since: { type: 'string' },
  },
});
if (!existsSync(join(STOREPEEK_DIR, 'src/lib/match.js'))) {
  console.error(`StorePeek engine not found in ${STOREPEEK_DIR} (set STOREPEEK_DIR).`);
  process.exit(1);
}

const local = await openLocalEnv();
let domains: string[] = values.domains ? values.domains.split(',').map((d) => d.trim()) : [];
if (values.curated) {
  const rows = await local.db.all<{ domain: string }>(
    "SELECT domain FROM stores WHERE is_curated = 1 AND status = 'active' ORDER BY list_position",
  );
  domains.push(...rows.map((r) => r.domain));
}
if (values.all) {
  const rows = await local.db.all<{ domain: string }>(
    "SELECT domain FROM stores WHERE status = 'active' ORDER BY is_curated DESC, list_position, id",
  );
  domains.push(...rows.map((r) => r.domain));
}
domains = [...new Set(domains)];
const allowed: string[] = [];
for (const d of domains) {
  if (await isCaptureBlocked(local.db, d)) console.log(`  skip ${d}: blocked or opted out`);
  else allowed.push(d);
}
await local.dispose();

const engine = await loadEngine();
const browser = await chromium.launch();
type Out = Awaited<ReturnType<typeof crawlStore>> & { error?: string };
const previous: Record<string, Out> = existsSync(SCANS_FILE)
  ? Object.fromEntries(
      (JSON.parse(readFileSync(SCANS_FILE, 'utf8')) as Out[]).map((o) => [o.scan.domain, o]),
    )
  : {};
const queue = values.since
  ? allowed.filter((d) => !(previous[d] && previous[d]!.scan.scanned_at >= values.since!))
  : [...allowed];
const results: Record<string, Out> = { ...previous };
/** Written as it goes so a long run can be resumed with --since. */
let unsaved = 0;
const save = () => {
  mkdirSync(dirname(SCANS_FILE), { recursive: true });
  writeFileSync(SCANS_FILE, JSON.stringify(Object.values(results), null, 2));
  unsaved = 0;
};
console.log(`Crawling ${queue.length} store(s)`);
const worker = async () => {
  for (let d = queue.shift(); d; d = queue.shift()) {
    try {
      const robots = await robotsFor(d);
      if (!robots.allows('/')) {
        console.log(`  skip ${d}: robots.txt disallows the home page`);
        continue;
      }
      const out = await crawlStore(browser, engine, d);
      if (robots.crawlDelay) await new Promise((r) => setTimeout(r, robots.crawlDelay! * 1000));
      results[d] = out;
      if (++unsaved >= 10) save();
      const s = out.scan;
      console.log(
        `  ok   ${d}: ${s.platform}, ${s.theme ? `${s.theme.name} ${s.theme.version ?? ''}` : 'no theme'}, ` +
          `${s.apps?.length ?? 0} apps, ${s.pixels?.length ?? 0} pixels${out.note ? ` (${out.note})` : ''}`,
      );
    } catch (e) {
      console.log(`  FAIL ${d}: ${String(e).split('\n')[0]}`);
    }
  }
};
try {
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
} finally {
  await browser.close();
}
save();
console.log(
  `Wrote ${Object.keys(results).length} scan(s) to .data/crawl/scans.json. Next: npm run crawl:ingest`,
);
