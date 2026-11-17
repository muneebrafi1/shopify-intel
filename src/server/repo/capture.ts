/**
 * Capture blocks: domains the screenshot pipeline must never capture again.
 *
 * A domain is blocked when an approved removal request of scope 'store' or 'screenshots' added
 * a `capture_blocks` row, or when it is tombstoned (`store_tombstones`, whole-store opt-out).
 * Blocks are permanent and outlive the removal request record (see migrations/0002).
 *
 * Contract for the capture pipeline (docs/ARCHITECTURE.md, "Capture pipeline"):
 *   1. Take the work list from listCaptureTargets() (or GET /api/v1/admin/capture-targets).
 *   2. Right before each capture, check isCaptureBlocked(domain) (or
 *      GET /api/v1/admin/capture-status/{domain}); a request may have been approved mid-run.
 *   3. The ingest step re-checks isCaptureBlocked() and discards uploads for blocked domains.
 */
import type { Db, SqlValue, Statement } from '../db/types.ts';
import { normalizeDomain } from '../lib/slug.ts';

export type CaptureBlockScope = 'store' | 'screenshots';

export interface CaptureBlock {
  domain: string;
  scope: CaptureBlockScope;
  /** 'removal-request', or 'tombstone' for opted-out domains without a block row. */
  reason: string;
  reference: string | null;
  removal_request_id: number | null;
  created_at: string;
}

/**
 * Upserts a block. A 'store' block is never downgraded to 'screenshots'; the original
 * created_at is kept.
 */
export function captureBlockStatement(
  input: {
    domain: string;
    scope: CaptureBlockScope;
    reason?: string;
    removalRequestId?: number | null;
    reference?: string | null;
  },
  now: Date,
): Statement {
  const ts = now.toISOString();
  return {
    sql: `INSERT INTO capture_blocks (domain, scope, reason, removal_request_id, reference, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (domain) DO UPDATE SET
            scope = CASE WHEN capture_blocks.scope = 'store' THEN 'store' ELSE excluded.scope END,
            reason = excluded.reason,
            removal_request_id = excluded.removal_request_id,
            reference = excluded.reference,
            updated_at = excluded.updated_at`,
    params: [
      input.domain,
      input.scope,
      input.reason ?? 'removal-request',
      input.removalRequestId ?? null,
      input.reference ?? null,
      ts,
      ts,
    ],
  };
}

const BLOCKS_SQL = `
  SELECT domain, scope, reason, reference, removal_request_id, created_at FROM capture_blocks
  UNION ALL
  SELECT t.domain, 'store' AS scope, 'tombstone' AS reason, NULL AS reference,
    t.removal_request_id, t.created_at
  FROM store_tombstones t
  WHERE NOT EXISTS (SELECT 1 FROM capture_blocks b WHERE b.domain = t.domain)`;

/** The block for a domain (a capture_blocks row, else its tombstone), or null. */
export async function captureBlockFor(db: Db, domainInput: string): Promise<CaptureBlock | null> {
  const domain = normalizeDomain(domainInput);
  if (!domain) return null;
  return db.first<CaptureBlock>(`SELECT * FROM (${BLOCKS_SQL}) WHERE domain = ? LIMIT 1`, [domain]);
}

/** True when the capture pipeline must not capture this domain. Two primary-key lookups. */
export async function isCaptureBlocked(db: Db, domainInput: string): Promise<boolean> {
  const domain = normalizeDomain(domainInput);
  if (!domain) return false;
  const row = await db.first<{ x: number }>(
    `SELECT 1 AS x FROM capture_blocks WHERE domain = ?1
     UNION ALL SELECT 1 FROM store_tombstones WHERE domain = ?1 LIMIT 1`,
    [domain],
  );
  return row !== null;
}

/** Every blocked domain, newest first (offset pages; the list is small). */
export async function listCaptureBlocks(
  db: Db,
  opts: { limit: number; offset?: number },
): Promise<{ items: CaptureBlock[]; total: number }> {
  const [items, total] = await Promise.all([
    db.all<CaptureBlock>(
      `SELECT * FROM (${BLOCKS_SQL}) ORDER BY created_at DESC, domain LIMIT ? OFFSET ?`,
      [opts.limit, opts.offset ?? 0],
    ),
    db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM (${BLOCKS_SQL})`),
  ]);
  return { items, total: total?.n ?? 0 };
}

export interface CaptureTarget {
  domain: string;
  url: string;
  is_curated: boolean;
  is_captured: boolean;
  list_position: number;
}

/**
 * Stores the capture pipeline may capture: active, not tombstoned, not blocked. `scope`
 * 'curated' (default) = stores with a capture plan; 'all' = every active detected store.
 * Keyset pagination on the catalogue order (`after` = the last list_position seen).
 */
export async function listCaptureTargets(
  db: Db,
  opts: { scope?: 'curated' | 'all'; limit: number; after?: number | null },
): Promise<{ items: CaptureTarget[]; next_after: number | null; total: number }> {
  const where = [
    "s.status = 'active'",
    'NOT EXISTS (SELECT 1 FROM capture_blocks b WHERE b.domain = s.domain)',
    'NOT EXISTS (SELECT 1 FROM store_tombstones t WHERE t.domain = s.domain)',
  ];
  if ((opts.scope ?? 'curated') === 'curated') where.push('s.is_curated = 1');
  const base = where.join(' AND ');
  const params: SqlValue[] = [];
  let seek = '';
  if (opts.after !== undefined && opts.after !== null) {
    seek = 'AND s.list_position > ?';
    params.push(opts.after);
  }
  const [rows, total] = await Promise.all([
    db.all<{
      domain: string;
      url: string | null;
      is_curated: number;
      is_captured: number;
      list_position: number;
    }>(
      `SELECT s.domain, s.url, s.is_curated, s.is_captured, s.list_position FROM stores s
       WHERE ${base} ${seek} ORDER BY s.list_position LIMIT ?`,
      [...params, opts.limit + 1],
    ),
    db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM stores s WHERE ${base}`),
  ]);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      domain: r.domain,
      url: r.url ?? `https://${r.domain}`,
      is_curated: r.is_curated === 1,
      is_captured: r.is_captured === 1,
      list_position: r.list_position,
    })),
    next_after: rows.length > opts.limit && last ? last.list_position : null,
    total: total?.n ?? 0,
  };
}
