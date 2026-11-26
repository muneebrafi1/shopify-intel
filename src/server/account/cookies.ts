/** Setting and clearing the session cookies from Astro endpoints. */
import type { AstroCookies } from 'astro';
import type { Db } from '../db/types.ts';
import {
  createSession,
  deleteSession,
  flagCookieOptions,
  sessionCookieOptions,
  SESSION_COOKIE,
  SIGNED_IN_COOKIE,
} from './sessions.ts';

export async function startSession(db: Db, cookies: AstroCookies, url: URL, userId: number) {
  const secure = url.protocol === 'https:';
  const { token, expiresAt } = await createSession(db, userId);
  cookies.set(SESSION_COOKIE, token, sessionCookieOptions(secure, expiresAt));
  cookies.set(SIGNED_IN_COOKIE, '1', flagCookieOptions(secure, expiresAt));
}

export async function endSession(db: Db, cookies: AstroCookies) {
  await deleteSession(db, cookies.get(SESSION_COOKIE)?.value);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  cookies.delete(SIGNED_IN_COOKIE, { path: '/' });
}
