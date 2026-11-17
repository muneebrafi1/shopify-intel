import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, RunResult, SqlValue, Statement } from './types.ts';

/**
 * Db adapter over node:sqlite (Node >= 22.5). Used by tests and scripts so they run the exact
 * SQL that D1 runs. Never import this from code that ships to the Worker.
 */
export interface NodeDb extends Db {
  /** The underlying handle, for bulk `exec` of migration / seed files. */
  readonly raw: DatabaseSync;
  close(): void;
}

export function openNodeDb(path = ':memory:'): NodeDb {
  const raw = new DatabaseSync(path);
  // D1 enforces foreign keys; match it so tests catch FK mistakes.
  raw.exec('PRAGMA foreign_keys = ON');

  const args = (params: readonly SqlValue[] = []): SQLInputValue[] => [...params];
  // node:sqlite returns null-prototype objects; spread them into plain objects so callers
  // (and test deep-equality) see ordinary records.
  const plain = <Row>(row: unknown): Row => ({ ...(row as object) }) as Row;

  const run = (sql: string, params?: readonly SqlValue[]): RunResult => {
    const res = raw.prepare(sql).run(...args(params));
    return { changes: Number(res.changes), lastRowId: Number(res.lastInsertRowid) || null };
  };

  return {
    raw,
    close: () => raw.close(),
    async all<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row[]> {
      return raw
        .prepare(sql)
        .all(...args(params))
        .map((r) => plain<Row>(r));
    },
    async first<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row | null> {
      const row = raw.prepare(sql).get(...args(params));
      return row === undefined ? null : plain<Row>(row);
    },
    async run(sql: string, params?: readonly SqlValue[]): Promise<RunResult> {
      return run(sql, params);
    },
    async batch(statements: readonly Statement[]): Promise<RunResult[]> {
      raw.exec('BEGIN');
      try {
        const results = statements.map((s) => run(s.sql, s.params));
        raw.exec('COMMIT');
        return results;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
