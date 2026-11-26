/**
 * POST /auth/dev — local development sign-in without Whop, for building and testing account
 * pages. Works only when DEV_SIGN_IN=1 (with USER_SESSION_SECRET set) AND the request is to a
 * local host (127.0.0.1 / localhost); anywhere else it is a 404. The plan picked here is written
 * straight to the user row, which only this route ever does.
 */
import type { APIRoute } from 'astro';
import { safeNext } from '~/components/static/content';
import { accountDb, whopConfig } from '~/server/account/env';
import { startSession } from '~/server/account/cookies';
import { upsertWhopUser } from '~/server/account/users';
import { isLocalHost } from '~/server/whop/config';
import { sha256, toHex } from '~/server/auth/crypto';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, cookies, redirect }) => {
  const config = whopConfig();
  if (!config.devSignIn || !isLocalHost(url)) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return redirect('/sign-in?error=email', 303);
  const plan = ['free', 'pro', 'team'].includes(String(form.get('plan')))
    ? String(form.get('plan'))
    : 'free';
  const db = accountDb();
  const whopUserId = `user_dev${toHex(await sha256(email)).slice(0, 12)}`;
  const userId = await upsertWhopUser(
    db,
    { whopUserId, email, name: email.split('@')[0] ?? null },
    { pro: null, team: null },
  );
  await db.run('UPDATE users SET plan = ? WHERE id = ?', [plan, userId]);
  await startSession(db, cookies, url, userId);
  return redirect(safeNext(String(form.get('next') ?? '')), 303);
};
