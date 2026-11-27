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

  // Coalesce all()/first() that start in the same tick into one D1 batch so a
  // Promise.all of reads is one round trip, not N concurrent D1 statements.
  type Pending = {
    kind: 'all' | 'first';
    sql: string;
    params?: readonly SqlValue[];
    resolve: (value: unknown) => void;
    reject: (err: unknown) => void;
  };
  let pending: Pending[] = [];
  let scheduled = false;

  const flush = async () => {
    const items = pending;
    pending = [];
    scheduled = false;
    if (items.length === 0) return;
    if (items.length === 1) {
      const it = items[0]!;
      try {
        if (it.kind === 'first') it.resolve(await withRetry(() => bind(it.sql, it.params).first()));
        else {
          const res = await withRetry(() => bind(it.sql, it.params).all());
          it.resolve(res.results);
        }
      } catch (err) {
        it.reject(err);
      }
      return;
    }
    try {
      const results = await withRetry(() => d1.batch(items.map((s) => bind(s.sql, s.params))));
      items.forEach((it, i) => {
        const rows = results[i]?.results ?? [];
        it.resolve(it.kind === 'first' ? (rows[0] ?? null) : rows);
      });
    } catch (err) {
      for (const it of items) it.reject(err);
    }
  };

  const enqueue = <T>(kind: 'all' | 'first', sql: string, params?: readonly SqlValue[]) =>
    new Promise<T>((resolve, reject) => {
      meter(1);
      pending.push({ kind, sql, params, resolve: resolve as (v: unknown) => void, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          void flush();
        });
      }
    });

  return {
    all<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row[]> {
      return enqueue<Row[]>('all', sql, params);
    },
    first<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row | null> {
      return enqueue<Row | null>('first', sql, params);
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
