/**
 * A deliberately tiny database interface. The same SQL runs on Cloudflare D1 (production, dev)
 * and on node:sqlite (tests, scripts). Keep queries to the SQLite dialect both understand.
 */

/** Values that can be bound to a statement. Booleans must be converted to 0/1 by the caller. */
export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: readonly SqlValue[];
}

export interface RunResult {
  /** Rows changed by the statement. */
  changes: number;
  /** Rowid of the last inserted row, when the statement inserted one. */
  lastRowId: number | null;
}

export interface Db {
  /** All rows. The row type is asserted by the caller (repositories define row interfaces). */
  all<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  /** First row or null. */
  first<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row | null>;
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  /** Runs statements in order, atomically (D1 batches are transactions). */
  batch(statements: readonly Statement[]): Promise<RunResult[]>;
}
