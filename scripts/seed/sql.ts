/**
 * Minimal SQL text writer for the generated seed file. Emits multi-row INSERTs chunked well
 * below D1's 100 KB statement limit, with no explicit transactions (D1 rejects BEGIN/COMMIT in
 * files; `wrangler d1 execute` runs the file atomically).
 */
import type { SqlValue } from '../../src/server/db/types.ts';

export type Row = Record<string, SqlValue | boolean | undefined>;

const MAX_STATEMENT_BYTES = 40_000;

export function sqlLiteral(value: SqlValue | boolean | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in seed: ${value}`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export class SqlWriter {
  private readonly parts: string[] = [];
  private readonly counts = new Map<string, number>();

  comment(text: string): void {
    this.parts.push(`\n-- ${text.replace(/\n/g, ' ')}`);
  }

  raw(statement: string): void {
    this.parts.push(`${statement.trim().replace(/;$/, '')};`);
  }

  insert(table: string, rows: readonly Row[]): void {
    if (rows.length === 0) return;
    const first = rows[0];
    if (!first) return;
    const columns = Object.keys(first);
    const head = `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`;
    let chunk: string[] = [];
    let bytes = head.length;
    const flush = () => {
      if (chunk.length) this.parts.push(`${head}${chunk.join(',\n')};`);
      chunk = [];
      bytes = head.length;
    };
    for (const row of rows) {
      const keys = Object.keys(row);
      if (keys.length !== columns.length || keys.some((k, i) => k !== columns[i])) {
        throw new Error(`Inconsistent columns for ${table}: ${keys.join(',')}`);
      }
      const tuple = `(${columns.map((c) => sqlLiteral(row[c])).join(', ')})`;
      if (bytes + tuple.length > MAX_STATEMENT_BYTES) flush();
      chunk.push(tuple);
      bytes += tuple.length + 2;
    }
    flush();
    this.counts.set(table, (this.counts.get(table) ?? 0) + rows.length);
  }

  rowCounts(): ReadonlyMap<string, number> {
    return this.counts;
  }

  toString(): string {
    return `${this.parts.join('\n')}\n`;
  }
}
