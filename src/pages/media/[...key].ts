/**
 * /media/<r2 key> — captured screenshots and crops from R2, cached as immutable.
 * /media/placeholder/... is served by its own (more specific) routes and 404s here.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveMedia } from '~/server/media/serve';

export const prerender = false;

export const GET: APIRoute = ({ params, request }) =>
  serveMedia(env.MEDIA, params.key ?? '', request);

export const HEAD: APIRoute = GET;
