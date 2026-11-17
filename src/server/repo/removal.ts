/**
 * Public removal requests. No raw IPs are stored: the client IP is hashed with a server-side
 * salt (IP_HASH_SALT) and only used to rate-limit.
 */
import type { Ctx } from '../api/v1/context.ts';
import { ApiError } from '../api/v1/errors.ts';
import type { RemovalRequestReceipt, RemovalScope } from '../api/v1/schemas/misc.ts';
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
  if ((byIp?.n ?? 0) >= RATE_LIMITS.perIpPerHour || (byDomain?.n ?? 0) >= RATE_LIMITS.perDomainPerDay) {
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
