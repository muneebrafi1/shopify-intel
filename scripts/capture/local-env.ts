/// <reference types="node" />
/**
 * The LOCAL bindings `astro dev` uses (D1 + R2 under .wrangler/state), opened from Node through
 * wrangler's platform proxy. Never touches remote resources: no account, no network calls to
 * Cloudflare. Stop `astro dev` first if writes fail with SQLITE_BUSY.
 */
import { getPlatformProxy } from 'wrangler';
import type { Db, RunResult, SqlValue, Statement } from '../../src/server/db/types.ts';

interface LocalBindings {
  DB: D1Database;
  MEDIA: R2Bucket;
}

/** Db over a D1 binding (src/server/db/d1.ts without the dev query meter, which needs Vite). */
export function d1Adapter(d1: D1Database): Db {
  const bind = (sql: string, params: readonly SqlValue[] = []) =>
    params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
  const meta = (m: D1Meta): RunResult => ({
    changes: m.changes ?? 0,
    lastRowId: m.last_row_id ?? null,
  });
  return {
    all: async <Row>(sql: string, params?: readonly SqlValue[]) =>
      (await bind(sql, params).all<Row>()).results,
    first: <Row>(sql: string, params?: readonly SqlValue[]) => bind(sql, params).first<Row>(),
    run: async (sql, params) => meta((await bind(sql, params).run()).meta),
    batch: async (statements: readonly Statement[]) =>
      statements.length
        ? (await d1.batch(statements.map((s) => bind(s.sql, s.params)))).map((r) => meta(r.meta))
        : [],
  };
}

export async function openLocalEnv() {
  const proxy = await getPlatformProxy<LocalBindings>({ persist: true });
  return {
    db: d1Adapter(proxy.env.DB),
    media: proxy.env.MEDIA,
    dispose: () => proxy.dispose(),
  };
}
