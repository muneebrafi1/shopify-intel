import type { Db, RunResult, SqlValue, Statement } from './types.ts';

/**
 * Dev-only query meter. D1 allows 50 queries per Worker invocation on the free plan, so the
 * middleware resets this per request in `astro dev` and reports it in an `x-d1-queries`
 * response header (calls / statements). Approximate under concurrent requests; never used in
 * production builds.
 */
export const queryMeter = { calls: 0, statements: 0 };
const meter = (statements: number) => {
  if (!import.meta.env.DEV) return;
  queryMeter.calls += 1;
  queryMeter.statements += statements;
};

const OVERLOAD =
  /D1_ERROR: D1 DB is overloaded|Too many resources consumed within a 10 second window/i;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry D1 reads that hit the 10-second resource window; leave other errors alone. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!OVERLOAD.test(msg) || i === attempts - 1) throw err;
      await sleep(80 * 2 ** i + Math.random() * 80);
    }
  }
  throw last;
}

/** Db adapter for a Cloudflare D1 binding. */
export function d1Db(d1: D1Database): Db {
  const bind = (sql: string, params: readonly SqlValue[] = []) =>
    params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);

  const toRunResult = (meta: D1Meta): RunResult => ({
    changes: meta.changes ?? 0,
    lastRowId: meta.last_row_id ?? null,
  });

  return {
    async all<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row[]> {
      meter(1);
      const res = await withRetry(() => bind(sql, params).all<Row>());
      return res.results;
    },
    async first<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row | null> {
      meter(1);
      return withRetry(() => bind(sql, params).first<Row>());
    },
    async run(sql: string, params?: readonly SqlValue[]): Promise<RunResult> {
      meter(1);
      const res = await withRetry(() => bind(sql, params).run());
      return toRunResult(res.meta);
    },
    async batch(statements: readonly Statement[]): Promise<RunResult[]> {
      if (statements.length === 0) return [];
      meter(statements.length);
      const results = await withRetry(() => d1.batch(statements.map((s) => bind(s.sql, s.params))));
      return results.map((r) => toRunResult(r.meta));
    },
    async allBatch<Row>(statements: readonly Statement[]): Promise<Row[][]> {
      if (statements.length === 0) return [];
      meter(statements.length);
      const results = await withRetry(() => d1.batch(statements.map((s) => bind(s.sql, s.params))));
      return results.map((r) => (r.results ?? []) as Row[]);
    },
  };
}
