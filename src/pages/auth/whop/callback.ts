/**
 * GET /auth/whop/callback?code=…&state=… — Whop sends the visitor back here. Checks the state
 * against the signed cookie, exchanges the code (PKCE verifier from the cookie), reads userinfo,
 * creates or links the user, starts a session and returns to `next`.
 * Errors go back to /sign-in with a short code; nothing secret is logged.
 */
import type { APIRoute } from 'astro';
import { safeNext } from '~/components/static/content';
import { accountDb, whopConfig } from '~/server/account/env';
import { startSession } from '~/server/account/cookies';
import { upsertWhopUser } from '~/server/account/users';
import { completeAuthorization, openState, STATE_COOKIE } from '~/server/whop/oauth';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const config = whopConfig();
  const fail = (code: string, next = '/account') =>
    redirect(`/sign-in?error=${code}&next=${encodeURIComponent(next)}`, 302);
  if (!config.oauth || !config.stateSecret) return fail('closed');

  const st = await openState(cookies.get(STATE_COOKIE)?.value, config.stateSecret);
  cookies.delete(STATE_COOKIE, { path: '/auth/whop' });
  if (!st) return fail('expired');
  const next = safeNext(st.next);
  if (url.searchParams.get('error')) return fail('denied', next);
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('state') !== st.state) return fail('state', next);

  try {
    const who = await completeAuthorization({
      apiOrigin: config.apiOrigin,
      clientId: config.oauth.clientId,
      clientSecret: config.oauth.clientSecret,
      redirectUri: `${url.origin}/auth/whop/callback`,
      code,
      verifier: st.verifier,
    });
    const db = accountDb();
    const userId = await upsertWhopUser(db, who, config.products);
    await startSession(db, cookies, url, userId);
  } catch (err) {
    console.error('whop sign-in failed:', err instanceof Error ? err.message : 'unknown');
    return fail('whop', next);
  }
  return redirect(next, 302);
};
