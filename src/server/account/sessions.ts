/**
 * Visitor sessions. The cookie holds 32 random bytes (base64url); the database keeps only their
 * SHA-256, so a leaked table cannot be replayed. Sessions last 30 days and are not renewed.
 *
 * Two cookies:
 *   vt_session  HttpOnly, SameSite=Lax, Secure on https — the credential.
 *   vt_in       readable flag ('1'), no credential — lets CDN-cached public pages show
 *               "Account" instead of "Sign in" from a tiny client script.
 */
import type { Db } from '../db/types.ts';
import { base64UrlEncode, sha256, toHex } from '../auth/crypto.ts';
import type { Plan } from './entitlements.ts';

export const SESSION_COOKIE = 'vt_session';
export const SIGNED_IN_COOKIE = 'vt_in';
export const USER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Per user; the oldest sessions are dropped beyond this. */
export const MAX_SESSIONS_PER_USER = 10;

export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
  plan: Plan | 'lifetime';
  whopUserId: string | null;
}

const hashToken = async (token: string) => toHex(await sha256(token));

export async function createSession(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(now.getTime() + USER_SESSION_TTL_SECONDS * 1000);
  await db.batch([
    {
      sql: 'INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      params: [await hashToken(token), userId, now.toISOString(), expiresAt.toISOString()],
    },
    {
      sql: `DELETE FROM user_sessions WHERE user_id = ? AND (expires_at <= ? OR token_hash NOT IN (
              SELECT token_hash FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?))`,
      params: [userId, now.toISOString(), userId, MAX_SESSIONS_PER_USER],
    },
  ]);
  return { token, expiresAt };
}

interface Row {
  id: number;
  email: string;
  name: string | null;
  plan: string;
  whop_user_id: string | null;
}

/** The signed-in user for a session cookie, or null (unknown, expired or malformed). */
export async function userForSession(
  db: Db,
  token: string | undefined | null,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.first<Row>(
    `SELECT u.id, u.email, u.name, u.plan, u.whop_user_id FROM user_sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    [await hashToken(token), now.toISOString()],
  );
  if (!row) return null;
  const plan = (['pro', 'team', 'lifetime'] as const).find((p) => p === row.plan) ?? 'free';
  return { id: row.id, email: row.email, name: row.name, plan, whopUserId: row.whop_user_id };
}

export async function deleteSession(db: Db, token: string | undefined | null): Promise<void> {
  if (!token || token.length > 64) return;
  await db.run('DELETE FROM user_sessions WHERE token_hash = ?', [await hashToken(token)]);
}

export function sessionCookieOptions(secure: boolean, expires?: Date) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    ...(expires ? { expires } : {}),
  };
}
export function flagCookieOptions(secure: boolean, expires?: Date) {
  return {
    path: '/',
    httpOnly: false,
    sameSite: 'lax' as const,
    secure,
    ...(expires ? { expires } : {}),
  };
}
