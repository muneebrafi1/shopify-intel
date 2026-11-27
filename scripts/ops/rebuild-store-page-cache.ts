#!/usr/bin/env node
/// <reference types="node" />
/**
 * Build store_page_cache from a local sqlite snapshot. Writes chunked INSERT SQL
 * for remote D1 (do not run computeStoreDetail against live D1 — it would overload it).
 *
 *   node scripts/ops/rebuild-store-page-cache.ts --local-file <snapshot.sqlite> --out-dir /tmp/store-cache-sql
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadDataInfo, type Ctx } from '../../src/server/api/v1/context.ts';
import { openNodeDb } from '../../src/server/db/node-sqlite.ts';
import { createNotifier } from '../../src/server/notify.ts';
import { computeStoreDetail } from '../../src/server/repo/stores.ts';

const { values } = parseArgs({
  options: {
    'local-file': { type: 'string' },
    'out-dir': { type: 'string' },
    limit: { type: 'string' },
  },
});
if (!values['local-file'] || !values['out-dir']) {
  console.error(
    'Usage: rebuild-store-page-cache.ts --local-file <sqlite> --out-dir <dir> [--limit N]',
  );
  process.exit(1);
}

const src = resolve(values['local-file']);
const outDir = resolve(values['out-dir']);
const limit = values.limit ? Number(values.limit) : Infinity;
mkdirSync(outDir, { recursive: true });

const copy = join(outDir, 'work.sqlite');
copyFileSync(src, copy);
// Also copy WAL/SHM if present so the snapshot is consistent.
for (const suffix of ['-wal', '-shm']) {
  try {
    copyFileSync(src + suffix, copy + suffix);
  } catch {
    // no WAL
  }
}

const db = openNodeDb(copy);
db.raw.exec(`
  CREATE TABLE IF NOT EXISTS store_page_cache (
    domain TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const data = await loadDataInfo(db);
const ctx: Ctx = {
  db,
  env: {},
  data,
  media: {},
  now: () => new Date(),
  request: null,
  notifier: createNotifier({ log: () => {} }),
  waitUntil: null,
  mediaStore: null,
};

const domains = (
  await db.all<{ domain: string }>(
    "SELECT domain FROM stores WHERE status = 'active' AND is_captured = 1 ORDER BY list_position",
  )
).map((r) => r.domain);
const todo = domains.slice(0, Number.isFinite(limit) ? Number(limit) : domains.length);
console.log(`computing ${todo.length} of ${domains.length} captured stores`);

const now = new Date().toISOString();
const rows: { domain: string; payload: string }[] = [];
let failed = 0;
const t0 = Date.now();
for (const [i, domain] of todo.entries()) {
  try {
    const detail = await computeStoreDetail(ctx, domain);
    const payload = JSON.stringify(detail);
    rows.push({ domain, payload });
    db.raw
      .prepare(
        'INSERT OR REPLACE INTO store_page_cache (domain, payload, updated_at) VALUES (?, ?, ?)',
      )
      .run(domain, payload, now);
  } catch (err) {
    failed += 1;
    console.error(`  fail ${domain}: ${err instanceof Error ? err.message : err}`);
  }
  if ((i + 1) % 50 === 0 || i + 1 === todo.length) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${i + 1}/${todo.length} ok=${rows.length} fail=${failed} ${dt}s`);
  }
}

const sizes = rows.map((r) => r.payload.length);
const sum = sizes.reduce((a, b) => a + b, 0);
console.log(
  `payloads ${rows.length}  bytes total=${sum} avg=${rows.length ? Math.round(sum / rows.length) : 0} max=${sizes.length ? Math.max(...sizes) : 0}`,
);

const CHUNK = 25;
const escape = (s: string) => s.replace(/'/g, "''");
let chunk = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  chunk += 1;
  const part = rows.slice(i, i + CHUNK);
  const sql = part
    .map(
      (r) =>
        `INSERT OR REPLACE INTO store_page_cache (domain, payload, updated_at) VALUES ('${escape(r.domain)}', '${escape(r.payload)}', '${now}');`,
    )
    .join('\n');
  const file = join(outDir, `chunk-${String(chunk).padStart(3, '0')}.sql`);
  writeFileSync(file, sql);
  console.log(`  wrote ${file} (${part.length} rows, ${sql.length} bytes)`);
}
console.log(`chunks ${chunk} failed ${failed}`);
db.close();
