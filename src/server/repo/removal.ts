/**
 * Public removal requests. No raw IPs are stored: the client IP is hashed with a server-side
 * salt (IP_HASH_SALT) and only used to rate-limit.
 */
import type { Ctx } from '../api/v1/context.ts';
import { ApiError } from '../api/v1/errors.ts';
import type { RemovalRequestReceipt, RemovalScope } from '../api/v1/schemas/misc.ts';
import type { Db, Statement } from '../db/types.ts';
import { normalizeDomain } from '../lib/slug.ts';

/** Used only when IP_HASH_SALT is unset (local dev and tests). */
const DEV_SALT = 'dev-only-ip-salt';

export const RATE_LIMITS = {
  perIpPerHour: 5,
  perDomainPerDay: 20,
} as const;

export async function hashIp(ip: string, salt: string | undefined): Promise<string> {
  const data = new TextEncoder().encode(`${salt || DEV_SALT}|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)

export function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `RR-${[...bytes].map((b) => ALPHABET[b % 32]).join('')}`;
}

export interface RemovalInput {
  domain: string;
  email: string;
  name?: string | undefined;
  reason: string;
  scope: RemovalScope;
  website?: string | undefined;
}

export async function createRemovalRequest(
  ctx: Ctx,
  input: RemovalInput,
): Promise<{ receipt: RemovalRequestReceipt; stored: boolean }> {
  const domain = normalizeDomain(input.domain);
  if (!domain) {
    throw new ApiError('validation_error', 'Enter the store’s domain, like example.com', {
      details: [{ path: 'domain', message: 'Not a valid domain' }],
    });
  }
  const now = ctx.now();
  const receipt: RemovalRequestReceipt = {
    reference: newReference(),
    status: 'pending',
    domain,
    scope: input.scope,
    received_at: now.toISOString(),
  };
  // Honeypot: bots fill every field. Pretend success so they learn nothing; store nothing.
  if (input.website && input.website.trim() !== '') return { receipt, stored: false };

  const ipHash = ctx.request?.ip ? await hashIp(ctx.request.ip, ctx.env.IP_HASH_SALT) : null;
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [byIp, byDomain] = await Promise.all([
    ipHash
      ? ctx.db.first<{ n: number }>(
          'SELECT COUNT(*) AS n FROM removal_requests WHERE ip_hash = ? AND created_at > ?',
          [ipHash, hourAgo],
        )
      : Promise.resolve({ n: 0 }),
    ctx.db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM removal_requests WHERE domain = ? AND created_at > ?',
      [domain, dayAgo],
    ),
  ]);
  if (
    (byIp?.n ?? 0) >= RATE_LIMITS.perIpPerHour ||
    (byDomain?.n ?? 0) >= RATE_LIMITS.perDomainPerDay
  ) {
    throw new ApiError('rate_limited', 'Too many requests. Please try again later.', {
      headers: { 'Retry-After': '3600' },
    });
  }
  await ctx.db.run(
    `INSERT INTO removal_requests (reference, domain, email, name, reason, scope, status, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      receipt.reference,
      domain,
      input.email.trim(),
      input.name?.trim() || null,
      input.reason.trim(),
      input.scope,
      ipHash,
      receipt.received_at,
    ],
  );
  return { receipt, stored: true };
}

// ---------------------------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------------------------

/**
 * Removal-request records (requester email, name, reason, hashed IP) are kept for two years
 * after the request was closed, then deleted. Owner decision (draft); the privacy page should
 * say the same.
 */
export const REMOVAL_RECORD_RETENTION_DAYS = 730;

export interface PurgeResult {
  /** Records deleted (or, with dryRun, that would be). */
  purged: number;
  /** Records closed before this instant are expired (ISO timestamp). */
  cutoff: string;
  retention_days: number;
  dry_run: boolean;
}

/** Closed (done / rejected) requests whose decision is older than the retention period. */
const EXPIRED = `status IN ('done', 'rejected') AND COALESCE(handled_at, created_at) < ?`;

/**
 * Deletes removal-request records closed more than REMOVAL_RECORD_RETENTION_DAYS ago. Pending
 * requests and approved ones still waiting for media deletion are never purged. What must
 * outlive the record is kept: capture blocks and tombstones stay (their removal_request_id is
 * cleared; the block keeps the public RR- reference). Writes one audit row when it deletes
 * anything. Safe to run repeatedly (e.g. daily from a Cron Trigger or the admin API).
 */
export async function purgeExpiredRemovalRecords(
  db: Db,
  now: Date,
  opts: { actor?: string; dryRun?: boolean } = {},
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - REMOVAL_RECORD_RETENTION_DAYS * 86_400_000).toISOString();
  const result = (purged: number): PurgeResult => ({
    purged,
    cutoff,
    retention_days: REMOVAL_RECORD_RETENTION_DAYS,
    dry_run: opts.dryRun === true,
  });
  const count = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM removal_requests WHERE ${EXPIRED}`,
    [cutoff],
  );
  const n = count?.n ?? 0;
  if (opts.dryRun || n === 0) return result(n);

  const expiredIds = `SELECT id FROM removal_requests WHERE ${EXPIRED}`;
  const statements: Statement[] = [
    {
      sql: `UPDATE capture_blocks SET removal_request_id = NULL WHERE removal_request_id IN (${expiredIds})`,
      params: [cutoff],
    },
    {
      sql: `UPDATE store_tombstones SET removal_request_id = NULL WHERE removal_request_id IN (${expiredIds})`,
      params: [cutoff],
    },
    { sql: `DELETE FROM removal_requests WHERE ${EXPIRED}`, params: [cutoff] },
    {
      sql: `INSERT INTO admin_audit (actor, action, target_type, target_id, detail_json, created_at)
            VALUES (?, 'removal.purge', 'removal', NULL, ?, ?)`,
      params: [
        (opts.actor ?? 'system').slice(0, 200),
        JSON.stringify({ purged: n, cutoff, retention_days: REMOVAL_RECORD_RETENTION_DAYS }),
        now.toISOString(),
      ],
    },
  ];
  const results = await db.batch(statements);
  return result(results[2]?.changes ?? n);
}
