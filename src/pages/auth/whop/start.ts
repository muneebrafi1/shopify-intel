/**
 * GET /auth/whop/start?next=/path → Whop's consent screen (OAuth 2.1 + PKCE). Without a Whop app
 * configured (WHOP_CLIENT_ID + USER_SESSION_SECRET) it returns to /sign-in with a notice.
 */
import type { APIRoute } from 'astro';
import { safeNext } from '~/components/static/content';
import { whopConfig } from '~/server/account/env';
import { STATE_COOKIE, STATE_TTL_SECONDS, startAuthorization } from '~/server/whop/oauth';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const next = safeNext(url.searchParams.get('next'));
  const config = whopConfig();
  if (!config.oauth || !config.stateSecret)
    return redirect(`/sign-in?error=closed&next=${encodeURIComponent(next)}`, 302);
  const { url: authorize, cookie } = await startAuthorization({
    apiOrigin: config.apiOrigin,
    clientId: config.oauth.clientId,
    redirectUri: `${url.origin}/auth/whop/callback`,
    next,
    stateSecret: config.stateSecret,
  });
  cookies.set(STATE_COOKIE, cookie, {
    path: '/auth/whop',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: STATE_TTL_SECONDS,
  });
  return redirect(authorize, 302);
};
