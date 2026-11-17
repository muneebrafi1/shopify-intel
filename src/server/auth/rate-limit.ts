/**
 * Login rate limiting, stored in D1 so it holds across isolates. Failed and successful sign-ins
 * are rows in `admin_audit` (action `auth.login_failed` / `auth.login`, target = salted hash of
 * the client IP), which doubles as the security log. No raw IPs are stored.
 *
 * Per IP: at most MAX_FAILURES_PER_IP failures in the window, counted since that IP's last
 * successful sign-in. Overall: at most MAX_FAILURES_TOTAL failures in the window from all IPs
 * (a ceiling against distributed guessing; it can lock the password form for everyone for up to
 * 15 minutes, which is acceptable because production uses Cloudflare Access).
 */
import type { Db, Statement } from '../db/types.ts';
import { sha256, toHex } from './crypto.ts';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_IP = 5;
export const MAX_FAILURES_TOTAL = 100;

export const LOGIN_FAILED = 'auth.login_failed';
export const LOGIN_OK = 'auth.login';

/** Salted SHA-256 of the client IP, truncated (enough to tell clients apart, not reversible). */
export async function hashClientIp(ip: string | null, salt: string): Promise<string> {
  return toHex(await sha256(`admin-login:${salt}:${ip ?? 'unknown'}`)).slice(0, 32);
}

export interface RateLimitState {
  blocked: boolean;
  /** Seconds until the oldest counted failure leaves the window (0 when not blocked). */
  retryAfter: number;
}

export async function loginRateLimit(db: Db, ipHash: string, now: Date): Promise<RateLimitState> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  const row = await db.first<{
    ip_n: number;
    ip_first: string | null;
    all_n: number;
    all_first: string | null;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM admin_audit
         WHERE action = ? AND target_id = ? AND created_at > ?
           AND created_at > COALESCE((SELECT MAX(created_at) FROM admin_audit WHERE action = ? AND target_id = ?), '')) AS ip_n,
       (SELECT MIN(created_at) FROM admin_audit
         WHERE action = ? AND target_id = ? AND created_at > ?
           AND created_at > COALESCE((SELECT MAX(created_at) FROM admin_audit WHERE action = ? AND target_id = ?), '')) AS ip_first,
       (SELECT COUNT(*) FROM admin_audit WHERE action = ? AND created_at > ?) AS all_n,
       (SELECT MIN(created_at) FROM admin_audit WHERE action = ? AND created_at > ?) AS all_first`,
    [
      LOGIN_FAILED,
      ipHash,
      since,
      LOGIN_OK,
      ipHash,
      LOGIN_FAILED,
      ipHash,
      since,
      LOGIN_OK,
      ipHash,
      LOGIN_FAILED,
      since,
      LOGIN_FAILED,
      since,
    ],
  );
  const retry = (first: string | null | undefined) =>
    first
      ? Math.max(1, Math.ceil((Date.parse(first) + LOGIN_WINDOW_MS - now.getTime()) / 1000))
      : 60;
  if ((row?.ip_n ?? 0) >= MAX_FAILURES_PER_IP)
    return { blocked: true, retryAfter: retry(row?.ip_first) };
  if ((row?.all_n ?? 0) >= MAX_FAILURES_TOTAL)
    return { blocked: true, retryAfter: retry(row?.all_first) };
  return { blocked: false, retryAfter: 0 };
}

export function loginAttemptStatement(ok: boolean, ipHash: string, now: Date): Statement {
  return {
    sql: `INSERT INTO admin_audit (actor, action, target_type, target_id, detail_json, created_at)
          VALUES (?, ?, 'client', ?, NULL, ?)`,
    params: [ok ? 'admin' : 'anonymous', ok ? LOGIN_OK : LOGIN_FAILED, ipHash, now.toISOString()],
  };
}
