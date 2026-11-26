/**
 * POST /api/whop/webhook: verify → dedupe on webhook-id → apply membership events → 200.
 * Every other event type is acknowledged and ignored. Whop retries non-2xx answers, so only a
 * failed signature/format or an internal error answers non-2xx.
 */
import type { Db } from '../db/types.ts';
import { applyMembership, refreshPlan, type Products } from '../account/users.ts';
import { MAX_BODY_BYTES, readMembership, verifyWebhook } from './webhook.ts';

export const EVENT_RETENTION_DAYS = 30;

export interface WebhookOutcome {
  status: number;
  result: 'applied' | 'stale' | 'duplicate' | 'ignored' | 'rejected' | 'unconfigured';
  detail?: string;
}

export async function handleWhopWebhook(opts: {
  db: Db;
  rawBody: string;
  headers: Headers;
  secret: string | null;
  products: Products;
  now?: Date;
}): Promise<WebhookOutcome> {
  const now = opts.now ?? new Date();
  if (!opts.secret) return { status: 503, result: 'unconfigured' };
  if (opts.rawBody.length > MAX_BODY_BYTES)
    return { status: 400, result: 'rejected', detail: 'body too large' };
  const v = await verifyWebhook(opts.rawBody, opts.headers, opts.secret, now);
  if (!v.ok) return { status: v.status, result: 'rejected', detail: v.reason };
  const { event } = v;

  const seen = await opts.db.first<{ id: string }>(
    'SELECT id FROM whop_webhook_events WHERE id = ?',
    [event.deliveryId],
  );
  if (seen) return { status: 200, result: 'duplicate' };

  let result: WebhookOutcome['result'] = 'ignored';
  if (event.type.startsWith('membership.')) {
    const m = readMembership(event.data);
    if (m) {
      const changed = await applyMembership(opts.db, m, event.timestamp, now);
      result = changed ? 'applied' : 'stale';
      if (m.whopUserId) await refreshPlan(opts.db, m.whopUserId, opts.products, now);
    }
  }
  // Recorded after the change is applied, so a failure above lets Whop's retry try again.
  const cutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * 86_400_000).toISOString();
  await opts.db.batch([
    {
      sql: 'INSERT OR IGNORE INTO whop_webhook_events (id, type, received_at) VALUES (?, ?, ?)',
      params: [event.deliveryId, event.type.slice(0, 80), now.toISOString()],
    },
    { sql: 'DELETE FROM whop_webhook_events WHERE received_at < ?', params: [cutoff] },
  ]);
  return { status: 200, result };
}
