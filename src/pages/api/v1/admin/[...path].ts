/**
 * /api/v1/admin/* — the protected admin API (docs/API.md, "Admin API"). The middleware has already
 * authenticated the request; the router's admin mount checks again. Never cached, no CORS.
 */
import type { APIRoute } from 'astro';
import { adminApiHandler } from '~/server/admin/api/worker';

export const prerender = false;

export const ALL: APIRoute = ({ request }) => adminApiHandler()(request);
