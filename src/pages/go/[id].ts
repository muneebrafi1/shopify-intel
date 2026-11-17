/** /go/<id> — affiliate redirect with an anonymous daily click count (never indexed). */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { d1Db } from '~/server/db/d1';
import { affiliateRedirect } from '~/server/repo/affiliate';

export const prerender = false;

export const GET: APIRoute = ({ params, request }) =>
  affiliateRedirect(d1Db(env.DB), params.id, request);

export const HEAD: APIRoute = GET;
