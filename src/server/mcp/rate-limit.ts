/**
 * Fixed-window D1 rate limiting for /mcp. Stores only a salted SHA-256 hash of the client IP
 * (IP_HASH_SALT), never the raw address. One statement per request on the hot path; old buckets
 * are pruned when a new IP-window row starts.
 */
import { sha256, toHex } from '../auth/crypto.ts';
import type { Db } from '../db/types.ts';
import { runInBackground, type WaitUntil } from '../notify.ts';

const DEV_SALT = 'dev-only-mcp-ip-salt';

export const MCP_RATE_LIMIT = {
  maxRequests: 60,
  windowSeconds: 60,
} as const;

export interface McpRateLimitOptions {
  salt?: string | undefined;
  now?: Date;
  maxRequests?: number;
  windowSeconds?: number;
  waitUntil?: WaitUntil | null;
}

export interface McpRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix timestamp (seconds) when the current window resets. */
  resetAt: number;
  /** Seconds until the next window opens (0 when allowed). */
  retryAfter: number;
}

export async function hashMcpIp(ip: string | null, salt: string | undefined): Promise<string> {
  const digest = await sha256(`mcp:${salt || DEV_SALT}:${ip ?? 'unknown'}`);
  return toHex(digest).slice(0, 32);
}

export async function checkMcpRateLimit(
  db: Db,
  ip: string | null,
  opts: McpRateLimitOptions = {},
): Promise<McpRateLimitResult> {
  const now = opts.now ?? new Date();
  const limit = opts.maxRequests ?? MCP_RATE_LIMIT.maxRequests;
  const windowSeconds = opts.windowSeconds ?? MCP_RATE_LIMIT.windowSeconds;
  const nowSec = Math.floor(now.getTime() / 1000);
  const bucket = Math.floor(nowSec / windowSeconds);
  const resetAt = (bucket + 1) * windowSeconds;
  const retryAfter = Math.max(1, resetAt - nowSec);
  const ipHash = await hashMcpIp(ip, opts.salt);

  const row = await db.first<{ count: number }>(
    `INSERT INTO mcp_rate_limits (ip_hash, bucket, count) VALUES (?, ?, 1)
     ON CONFLICT (ip_hash, bucket) DO UPDATE SET count = MIN(count + 1, ?)
     RETURNING count`,
    [ipHash, bucket, limit + 1],
  );
  const count = row?.count ?? 1;

  if (count === 1) {
    await runInBackground(opts.waitUntil ?? null, async () => {
      await db.run('DELETE FROM mcp_rate_limits WHERE bucket < ?', [bucket - 2]);
    });
  }

  const allowed = count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfter: allowed ? 0 : retryAfter,
  };
}

export function rateLimitHeaders(rate: McpRateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rate.limit),
    'X-RateLimit-Remaining': String(rate.remaining),
    'X-RateLimit-Reset': String(rate.resetAt),
    ...(rate.allowed ? {} : { 'Retry-After': String(rate.retryAfter) }),
  };
}
