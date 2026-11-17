/**
 * /api/v1/* — the public, versioned JSON API. All routing, validation, caching and CORS live in
 * src/server/api/v1/router.ts; this file only hands the request over. See docs/API.md.
 */
import type { APIRoute } from 'astro';
import { apiHandler } from '~/server/api';

export const prerender = false;

export const ALL: APIRoute = ({ request }) => apiHandler()(request);
