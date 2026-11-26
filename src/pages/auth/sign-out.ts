/** POST /auth/sign-out — ends this session (same-origin form post; checked in middleware). */
import type { APIRoute } from 'astro';
import { accountDb } from '~/server/account/env';
import { endSession } from '~/server/account/cookies';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  await endSession(accountDb(), cookies);
  return redirect('/?signed_out=1', 303);
};
