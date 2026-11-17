/**
 * Opaque cursors and keyset ("seek") pagination. Keyset pages cost the same at page 1 and page
 * 1,000 because the WHERE clause seeks into an index instead of using OFFSET.
 */
import type { SqlValue } from '../../db/types.ts';
import { ApiError } from './errors.ts';

export interface SortKey<Row> {
  /** SQL expression (must be part of the ORDER BY and ideally of an index). */
  expr: string;
  dir: 'asc' | 'desc';
  /** Reads the key value from a result row (select the expression under an alias). */
  pick: (row: Row) => SqlValue;
}

export function encodeCursor(values: readonly SqlValue[]): string {
  const json = JSON.stringify(values);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeCursor(cursor: string, length: number): SqlValue[] {
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      Array.isArray(parsed) &&
      parsed.length === length &&
      parsed.every((v) => v === null || typeof v === 'string' || typeof v === 'number')
    ) {
      return parsed as SqlValue[];
    }
  } catch {
    // fall through
  }
  throw new ApiError('bad_request', 'Invalid cursor');
}

export function orderBy<Row>(keys: readonly SortKey<Row>[]): string {
  return keys.map((k) => `${k.expr} ${k.dir.toUpperCase()}`).join(', ');
}

/**
 * `(k1 > v1) OR (k1 = v1 AND k2 > v2) …` for mixed sort directions. Keys must end with a
 * unique column so the order is total. NULL key values are not supported (use COALESCE).
 */
export function keysetWhere<Row>(
  keys: readonly SortKey<Row>[],
  values: readonly SqlValue[],
): { sql: string; params: SqlValue[] } {
  const ors: string[] = [];
  const params: SqlValue[] = [];
  keys.forEach((key, i) => {
    const parts: string[] = [];
    for (let j = 0; j < i; j++) {
      const prev = keys[j];
      if (!prev) continue;
      parts.push(`${prev.expr} = ?`);
      params.push(values[j] ?? null);
    }
    parts.push(`${key.expr} ${key.dir === 'asc' ? '>' : '<'} ?`);
    params.push(values[i] ?? null);
    ors.push(`(${parts.join(' AND ')})`);
  });
  return { sql: `(${ors.join(' OR ')})`, params };
}

/** Splits a limit+1 result into a page and the next cursor. */
export function pageOf<Row>(
  rows: Row[],
  limit: number,
  keys: readonly SortKey<Row>[],
): { rows: Row[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null };
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: last ? encodeCursor(keys.map((k) => k.pick(last))) : null };
}

/** Offset cursors for small, bounded catalogues (themes, apps). */
export function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const [offset] = decodeCursor(cursor, 1);
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new ApiError('bad_request', 'Invalid cursor');
  }
  return offset;
}

export function nextOffsetCursor(offset: number, limit: number, total: number): string | null {
  return offset + limit < total ? encodeCursor([offset + limit]) : null;
}
