/**
 * Users and their Whop memberships. users.plan is a cache of planFor(memberships), rewritten
 * whenever a membership webhook arrives or the user signs in.
 */
import type { Db } from '../db/types.ts';
import type { MembershipRecord } from '../whop/webhook.ts';
import { planFor } from './entitlements.ts';
import type { WhopIdentity } from '../whop/oauth.ts';

export interface Products {
  pro: string | null;
  team: string | null;
}

/**
 * Finds or creates the user for a Whop identity. Matched by Whop user id first, then by email
 * (an earlier account with the same email is linked). Whop may withhold the email; then a
 * placeholder address `<user_id>@users.whop.invalid` keeps the NOT NULL column honest.
 */
export async function upsertWhopUser(
  db: Db,
  who: WhopIdentity,
  products: Products,
  now: Date = new Date(),
): Promise<number> {
  const at = now.toISOString();
  const email = who.email ?? `${who.whopUserId.toLowerCase()}@users.whop.invalid`;
  let row = await db.first<{ id: number }>('SELECT id FROM users WHERE whop_user_id = ?', [
    who.whopUserId,
  ]);
  if (!row && who.email)
    row = await db.first<{ id: number }>(
      'SELECT id FROM users WHERE email = ? AND whop_user_id IS NULL',
      [who.email],
    );
  let id: number;
  if (row) {
    id = row.id;
    await db.run(
      `UPDATE users SET whop_user_id = ?, name = COALESCE(?, name),
         email = CASE WHEN ? IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users o WHERE o.email = ? AND o.id <> users.id) THEN ? ELSE email END,
         last_sign_in_at = ?, updated_at = ? WHERE id = ?`,
      [who.whopUserId, who.name, who.email, who.email, who.email, at, at, id],
    );
  } else {
    const res = await db.run(
      `INSERT INTO users (email, whop_user_id, name, plan, last_sign_in_at, created_at, updated_at)
       VALUES (?, ?, ?, 'free', ?, ?, ?)`,
      [email, who.whopUserId, who.name, at, at, at],
    );
    id = Number(res.lastRowId);
  }
  await refreshPlan(db, who.whopUserId, products, now);
  return id;
}

/** Recomputes users.plan from the stored memberships of one Whop user. Lifetime is kept. */
export async function refreshPlan(
  db: Db,
  whopUserId: string,
  products: Products,
  now: Date = new Date(),
): Promise<void> {
  const rows = await db.all<{ product_id: string; status: string }>(
    'SELECT product_id, status FROM whop_memberships WHERE whop_user_id = ?',
    [whopUserId],
  );
  const plan = planFor(
    rows.map((r) => ({ productId: r.product_id, status: r.status })),
    products,
  );
  await db.run(
    `UPDATE users SET plan = ?, updated_at = ? WHERE whop_user_id = ? AND plan <> 'lifetime' AND plan <> ?`,
    [plan, now.toISOString(), whopUserId, plan],
  );
}

/**
 * Stores a membership as reported by an event. An event older than the one already applied is
 * ignored (deliveries can arrive out of order). Returns whether the row changed.
 */
export async function applyMembership(
  db: Db,
  m: MembershipRecord,
  eventAt: string,
  now: Date = new Date(),
): Promise<boolean> {
  const res = await db.run(
    `INSERT INTO whop_memberships (id, whop_user_id, product_id, variant_id, status,
       cancel_at_period_end, current_period_end, manage_url, event_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       whop_user_id = COALESCE(excluded.whop_user_id, whop_memberships.whop_user_id),
       product_id = excluded.product_id, variant_id = COALESCE(excluded.variant_id, whop_memberships.variant_id),
       status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
       current_period_end = COALESCE(excluded.current_period_end, whop_memberships.current_period_end),
       manage_url = COALESCE(excluded.manage_url, whop_memberships.manage_url),
       event_at = excluded.event_at, updated_at = excluded.updated_at
     WHERE excluded.event_at >= whop_memberships.event_at`,
    [
      m.id,
      m.whopUserId,
      m.productId,
      m.variantId,
      m.status,
      m.cancelAtPeriodEnd ? 1 : 0,
      m.currentPeriodEnd,
      m.manageUrl,
      eventAt,
      now.toISOString(),
    ],
  );
  return res.changes > 0;
}

export interface MembershipView {
  id: string;
  productId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  manageUrl: string | null;
}

export async function membershipsFor(db: Db, whopUserId: string | null): Promise<MembershipView[]> {
  if (!whopUserId) return [];
  const rows = await db.all<{
    id: string;
    product_id: string;
    status: string;
    cancel_at_period_end: number;
    current_period_end: string | null;
    manage_url: string | null;
  }>(
    `SELECT id, product_id, status, cancel_at_period_end, current_period_end, manage_url
     FROM whop_memberships WHERE whop_user_id = ? ORDER BY updated_at DESC LIMIT 10`,
    [whopUserId],
  );
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    status: r.status,
    cancelAtPeriodEnd: r.cancel_at_period_end === 1,
    currentPeriodEnd: r.current_period_end,
    manageUrl: r.manage_url,
  }));
}

/** Deletes the account: boards, sessions and the user row (memberships stay for billing). */
export async function deleteUser(db: Db, userId: number): Promise<void> {
  await db.batch([
    {
      sql: 'DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)',
      params: [userId],
    },
    { sql: 'DELETE FROM collections WHERE user_id = ?', params: [userId] },
    { sql: 'DELETE FROM user_sessions WHERE user_id = ?', params: [userId] },
    { sql: 'DELETE FROM users WHERE id = ?', params: [userId] },
  ]);
}
