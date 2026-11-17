import type { Db, RunResult, SqlValue, Statement } from './types.ts';

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
      const res = await bind(sql, params).all<Row>();
      return res.results;
    },
    async first<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row | null> {
      return bind(sql, params).first<Row>();
    },
    async run(sql: string, params?: readonly SqlValue[]): Promise<RunResult> {
      const res = await bind(sql, params).run();
      return toRunResult(res.meta);
    },
    async batch(statements: readonly Statement[]): Promise<RunResult[]> {
      if (statements.length === 0) return [];
      const results = await d1.batch(statements.map((s) => bind(s.sql, s.params)));
      return results.map((r) => toRunResult(r.meta));
    },
  };
}
