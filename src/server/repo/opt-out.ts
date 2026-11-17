/**
 * Store opt-out (for the admin removal workflow). Hides the store everywhere public, records a
 * tombstone so the crawler never re-adds the domain, and rebuilds every derived table so counts
 * and search no longer include it. Returns the R2 keys the caller must delete.
 */
import type { Db } from '../db/types.ts';
import { normalizeDomain } from '../lib/slug.ts';
import { REBUILD_DERIVED_SQL } from './maintenance.ts';

export interface OptOutResult {
  storeId: number;
  domain: string;
  /** Screenshot and crop keys to delete from R2 (the DB rows stay hidden, not public). */
  mediaKeys: string[];
}

export async function optOutStore(
  db: Db,
  domainInput: string,
  opts: { reason?: string; removalRequestId?: number; now?: Date } = {},
): Promise<OptOutResult | null> {
  const domain = normalizeDomain(domainInput);
  if (!domain) return null;
  const store = await db.first<{ id: number }>('SELECT id FROM stores WHERE domain = ?', [domain]);
  if (!store) return null;
  const at = (opts.now ?? new Date()).toISOString();
  const keys = await db.all<{ key: string }>(
    `SELECT r2_key AS key FROM screenshots WHERE store_id = ? AND r2_key IS NOT NULL
     UNION SELECT r2_key_crop AS key FROM sections WHERE store_id = ? AND r2_key_crop IS NOT NULL`,
    [store.id, store.id],
  );
  await db.batch([
    {
      sql: "UPDATE stores SET status = 'opted_out', opted_out_at = ?, updated_at = ? WHERE id = ?",
      params: [at, at, store.id],
    },
    {
      sql: `INSERT INTO store_tombstones (domain, reason, removal_request_id, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (domain) DO UPDATE SET reason = excluded.reason,
              removal_request_id = excluded.removal_request_id`,
      params: [domain, opts.reason ?? null, opts.removalRequestId ?? null, at],
    },
    ...REBUILD_DERIVED_SQL.map((sql) => ({ sql })),
  ]);
  return { storeId: store.id, domain, mediaKeys: keys.map((k) => k.key) };
}

/** True when the crawler must skip this domain. */
export async function isTombstoned(db: Db, domainInput: string): Promise<boolean> {
  const domain = normalizeDomain(domainInput);
  if (!domain) return false;
  return (
    (await db.first('SELECT 1 AS x FROM store_tombstones WHERE domain = ?', [domain])) !== null
  );
}
