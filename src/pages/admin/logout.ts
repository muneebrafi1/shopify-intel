/**
 * Sign out (POST only; the middleware enforces the same-origin check). Clears the session
 * cookie. With Cloudflare Access, the Access session is ended by its own logout URL.
 */
import type { APIRoute } from 'astro';
import { adminDb } from '~/server/admin/env';
import { auditStatement } from '~/server/admin/audit';
import { isLocalHttp, sessionCookieName } from '~/server/auth/guard';

export const POST: APIRoute = async ({ cookies, url, locals, redirect }) => {
  const session = locals.admin;
  // __Host- cookies are only replaced when the attributes match (Secure, Path=/).
  cookies.delete(sessionCookieName(url), {
    path: '/',
    secure: !isLocalHttp(url),
    httpOnly: true,
    sameSite: 'strict',
  });
  if (session) {
    await adminDb().batch([auditStatement({ actor: session.actor, action: 'auth.logout' }, new Date())]);
  }
  if (session?.method === 'access') return redirect('/cdn-cgi/access/logout', 303);
  return redirect('/admin/login?ok=signed_out', 303);
};

/** Signing out changes state, so GET never does it. */
export const GET: APIRoute = ({ redirect }) => redirect('/admin', 302);
