#!/usr/bin/env node
/// <reference types="node" />
/**
 * Row-diff sync of the LOCAL D1 (seed + ingested captures) to a REMOTE D1, so a deploy writes
 * only what changed. The D1 free plan allows 100k rows written per day per account (index
 * updates count too), and a full re-seed is about that, so never re-seed a remote database.
 *
 *   node scripts/ops/d1-sync.ts --config <wrangler config>            # dry run: plan + estimate
 *   node scripts/ops/d1-sync.ts --config <wrangler config> --apply    # write it
 *   --tables stores,apps   only these tables   --max-writes 60000   refuse bigger plans
 *   --local-file snapshot.sqlite   sync from a copy of the local D1 instead of the live one
 *
 * Content tables only. Runtime tables the live site writes (users, sessions, boards, removal
 * requests, capture blocks, tombstones, audit, rate limits, clicks, jobs, webhook events) are
 * never read or written. Opt-outs win: rows of a store that is blocked, tombstoned, hidden or
 * opted out on the remote are never inserted or updated, and its remote status is kept.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

type Value = string | number | null;
type Row = Record<string, Value>;

export const RUNTIME_TABLES = new Set([
  'admin_audit',
  'capture_blocks',
  'clicks',
  'collection_items',
  'collections',
  'mcp_rate_limits',
  'removal_requests',
  'scan_jobs',
  'store_tombstones',
  'user_sessions',
  'users',
  'whop_memberships',
  'whop_webhook_events',
  'd1_migrations',
  'sqlite_sequence',
]);
/** FTS5 table: no primary key, rowids are reassigned on rebuild; keyed by (kind, ref). */
const FTS = 'search_index';
/** Tables whose rows belong to one store (column holding the store id). */
const STORE_COLUMN: Record<string, string> = {
  stores: 'id',
  pages: 'store_id',
  screenshots: 'store_id',
  sections: 'store_id',
  store_apps: 'store_id',
  store_themes: 'store_id',
  store_pixels: 'store_id',
  store_unresolved_apps: 'store_id',
  scans: 'store_id',
};

export const sqlValue = (v: Value): string =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

export interface TableDiff {
  table: string;
  inserts: Row[];
  updates: Row[];
  deletes: Row[];
}

/** Diffs two row sets by key. Without a key the whole row is the key (insert/delete only). */
export function diffRows(
  table: string,
  local: Row[],
  remote: Row[],
  key: string[],
  skip: (row: Row) => boolean = () => false,
): TableDiff {
  const cols = local[0] ? Object.keys(local[0]) : remote[0] ? Object.keys(remote[0]) : [];
  const k = key.length ? key : cols;
  const id = (r: Row) => JSON.stringify(k.map((c) => r[c] ?? null));
  const body = (r: Row) => JSON.stringify(cols.map((c) => r[c] ?? null));
  const remoteBy = new Map(remote.map((r) => [id(r), r]));
  const localKeys = new Set<string>();
  const out: TableDiff = { table, inserts: [], updates: [], deletes: [] };
  for (const r of local) {
    const kk = id(r);
    localKeys.add(kk);
    const old = remoteBy.get(kk);
    if (skip(r) || (old && skip(old))) continue;
    if (!old) out.inserts.push(r);
    else if (key.length && body(old) !== body(r)) out.updates.push(r);
  }
  for (const [kk, r] of remoteBy) if (!localKeys.has(kk) && !skip(r)) out.deletes.push(r);
  return out;
}

export function diffSql(d: TableDiff, key: string[]): string[] {
  const lines: string[] = [];
  const where = (r: Row) => {
    const k = key.length ? key : Object.keys(r);
    return k
      .map((c) => (r[c] === null ? `"${c}" IS NULL` : `"${c}" = ${sqlValue(r[c]!)}`))
      .join(' AND ');
  };
  const insert = (r: Row, upsert: boolean) => {
    const cols = Object.keys(r);
    let s = `INSERT INTO "${d.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
      .map((c) => sqlValue(r[c]!))
      .join(', ')})`;
    const rest = cols.filter((c) => !key.includes(c));
    if (upsert && key.length && rest.length)
      s += ` ON CONFLICT (${key.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ${rest
        .map((c) => `"${c}" = excluded."${c}"`)
        .join(', ')}`;
    return `${s};`;
  };
  for (const r of d.deletes) lines.push(`DELETE FROM "${d.table}" WHERE ${where(r)};`);
  if (d.table === FTS) {
    for (const r of d.updates) lines.push(`DELETE FROM "${d.table}" WHERE ${where(r)};`);
    for (const r of [...d.updates, ...d.inserts]) lines.push(insert(r, false));
  } else {
    for (const r of [...d.updates, ...d.inserts]) lines.push(insert(r, true));
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
const ROOT = resolve(new URL('../..', import.meta.url).pathname);

function localDb(file?: string): DatabaseSync {
  if (file) return new DatabaseSync(resolve(file), { readOnly: true });
  const dir = join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (!file) throw new Error('No local D1. Run `npm run setup` first.');
  return new DatabaseSync(join(dir, file), { readOnly: true });
}

function wrangler(args: string[], attempts = 4): string {
  for (let i = 1; ; i++) {
    try {
      return wranglerOnce(args);
    } catch (e) {
      if (i >= attempts || !String(e).includes('fetch failed')) throw e;
    }
  }
}

function wranglerOnce(args: string[]): string {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function remoteAll(config: string, db: string, sql: string): Row[] {
  const out = wrangler([
    'd1',
    'execute',
    db,
    '--remote',
    '--json',
    '--config',
    config,
    '--command',
    sql,
  ]);
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as Array<{ results: Row[] }>;
  return parsed.flatMap((p) => p.results);
}

function remoteTable(config: string, db: string, table: string, cols: string[]): Row[] {
  const rows: Row[] = [];
  const page = 5000;
  const list = cols.map((c) => `"${c}"`).join(', ');
  for (let off = 0; ; off += page) {
    const chunk = remoteAll(
      config,
      db,
      `SELECT ${list} FROM "${table}" ORDER BY rowid LIMIT ${page} OFFSET ${off}`,
    );
    rows.push(...chunk);
    if (chunk.length < page) return rows;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      db: { type: 'string', default: 'DB' },
      apply: { type: 'boolean', default: false },
      tables: { type: 'string' },
      'max-writes': { type: 'string', default: '90000' },
      /** A copy of the local D1 sqlite file to sync from (default: the live local D1). */
      'local-file': { type: 'string' },
    },
  });
  if (!values.config) throw new Error('--config <wrangler config for the remote> is required');
  const config = resolve(values.config);
  const local = localDb(values['local-file']);
  const all = (
    local
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'
       AND name NOT LIKE '${FTS}_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  const wanted = values.tables ? new Set(values.tables.split(',')) : null;
  const tables = all.filter((t) => !RUNTIME_TABLES.has(t) && (!wanted || wanted.has(t)));

  // Opt-outs on the remote win over anything local.
  const blocked = new Set(
    remoteAll(
      config,
      values.db!,
      `SELECT domain FROM capture_blocks UNION SELECT domain FROM store_tombstones`,
    ).map((r) => String(r.domain)),
  );
  const remoteStores = remoteAll(config, values.db!, `SELECT id, domain, status FROM stores`);
  const protectedIds = new Set(
    remoteStores
      .filter((s) => blocked.has(String(s.domain)) || s.status !== 'active')
      .map((s) => Number(s.id)),
  );
  console.log(
    `remote: ${remoteStores.length} stores, ${protectedIds.size} protected (opt-out/hidden/blocked)`,
  );

  // Parent tables first (foreign keys), children last; deletes run in reverse.
  const deps = new Map<string, string[]>();
  for (const t of tables) {
    const fks = local.prepare(`PRAGMA foreign_key_list("${t}")`).all() as Array<{ table: string }>;
    deps.set(
      t,
      fks.map((f) => f.table).filter((x) => x !== t && tables.includes(x)),
    );
  }
  const order: string[] = [];
  const visit = (t: string, seen = new Set<string>()) => {
    if (order.includes(t) || seen.has(t)) return;
    seen.add(t);
    for (const d of deps.get(t) ?? []) visit(d, seen);
    order.push(t);
  };
  for (const t of tables) visit(t);

  const diffs: Array<{ d: TableDiff; key: string[]; indexes: number }> = [];
  for (const t of order) {
    const info = local.prepare(`PRAGMA table_info("${t}")`).all() as Array<{
      name: string;
      pk: number;
    }>;
    const cols = info.map((c) => c.name);
    const key =
      t === FTS
        ? ['kind', 'ref']
        : info
            .filter((c) => c.pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map((c) => c.name);
    const localRows = local
      .prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t}"`)
      .all() as Row[];
    const remoteRows = remoteTable(config, values.db!, t, cols);
    const sc = STORE_COLUMN[t];
    const skip = sc ? (r: Row) => protectedIds.has(Number(r[sc])) : undefined;
    const d = diffRows(t, localRows, remoteRows, key, skip);
    const indexes = (local.prepare(`PRAGMA index_list("${t}")`).all() as unknown[]).length;
    diffs.push({ d, key, indexes });
    const n = d.inserts.length + d.updates.length + d.deletes.length;
    if (n)
      console.log(`${t.padEnd(24)} +${d.inserts.length} ~${d.updates.length} -${d.deletes.length}`);
  }
  // Every changed row writes the row plus one entry per index (FTS: several shadow rows).
  const estimate = diffs.reduce((sum, { d, indexes }) => {
    const per = d.table === FTS ? 6 : 1 + indexes;
    return (
      sum +
      (d.inserts.length + d.deletes.length + d.updates.length * (d.table === FTS ? 2 : 1)) * per
    );
  }, 0);
  console.log(`estimated rows written: ~${estimate}`);

  const lines = ['PRAGMA defer_foreign_keys = true;'];
  for (const { d, key } of [...diffs].reverse())
    for (const l of diffSql({ ...d, inserts: [], updates: [] }, key)) lines.push(l);
  for (const { d, key } of diffs)
    for (const l of diffSql({ ...d, deletes: [] }, key)) lines.push(l);
  mkdirSync(join(ROOT, '.data/sync'), { recursive: true });
  const file = join(ROOT, `.data/sync/${new Date().toISOString().replace(/[:.]/g, '')}.sql`);
  writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`plan: ${lines.length - 1} statements → ${file}`);
  if (!values.apply) return;
  if (lines.length === 1) return console.log('nothing to apply');
  if (estimate > Number(values['max-writes'])) {
    console.error(
      `refusing: estimate ${estimate} > --max-writes ${values['max-writes']} (split with --tables)`,
    );
    process.exit(1);
  }
  console.log(
    wrangler([
      'd1',
      'execute',
      values.db!,
      '--remote',
      '--yes',
      '--config',
      config,
      '--file',
      file,
    ]).slice(-600),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await main();
}
