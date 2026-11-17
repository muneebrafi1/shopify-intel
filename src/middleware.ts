/**
 * Site-wide middleware. Its only job is to guard the admin; every other request goes straight
 * to `next()` after one cheap path check.
 *
 * Guarded: /admin/** (except the sign-in page, which still gets the headers and CSRF check) and
 * /api/v1/admin/**. Protection is server-side only:
 *   1. Non-GET requests must come from this origin (CSRF), on top of SameSite=Strict cookies.
 *   2. Cloudflare Access JWT (primary, production) or the signed password-session cookie (local,
 *      and the break-glass backup next to Access).
 *   3. /api/v1/admin/** also accepts `Authorization: Bearer <ADMIN_API_TOKEN>` (scripts, MCP);
 *      bearer requests skip the CSRF check (browsers never send the header on their own).
 *   4. Not configured → locked, never open.
 * Every admin response gets no-store / noindex / no-framing headers. The admin API router checks
 * the same credentials again (defence in depth).
 */
import { defineMiddleware } from 'astro:middleware';
import {
  adminAreaFor,
  authenticate,
  authenticateAdminApi,
  isSafeMethod,
  isSameOrigin,
  jsonError,
  withAdminHeaders,
  type AdminArea,
} from './server/auth/guard.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  const area = adminAreaFor(context.url.pathname);
  if (area === null) return next();
  return withAdminHeaders(await guardAdmin(context, next, area));
});

type Ctx = Parameters<Parameters<typeof defineMiddleware>[0]>[0];
type Next = Parameters<Parameters<typeof defineMiddleware>[0]>[1];

async function guardAdmin(context: Ctx, next: Next, area: AdminArea): Promise<Response> {
  const { request, url, cookies, locals } = context;

  if (area === 'api') {
    // Loaded lazily so the public fast path never touches admin code or bindings.
    const { adminAuthConfig, adminApiToken } = await import('./server/admin/env.ts');
    const auth = await authenticateAdminApi({
      config: adminAuthConfig(),
      apiToken: adminApiToken(),
      request,
      url,
      getCookie: (name) => cookies.get(name)?.value,
    });
    if (!auth.ok) return jsonError(auth.status, auth.code, auth.message);
    locals.admin = auth.session;
    return next();
  }

  if (!isSafeMethod(request.method) && !isSameOrigin(request, url)) {
    return new Response('Cross-origin request blocked.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Loaded lazily so the public fast path never touches admin code or bindings.
  const { adminAuthConfig } = await import('./server/admin/env.ts');
  const config = adminAuthConfig();
  locals.adminAuth =
    config.mode === 'locked' ? { mode: 'locked', reason: config.reason } : { mode: config.mode };

  if (config.mode === 'locked') {
    // The sign-in page explains what is missing (names only).
    return area === 'login' ? next() : context.redirect('/admin/login', 302);
  }

  const session = await authenticate({
    config,
    request,
    url,
    getCookie: (name) => cookies.get(name)?.value,
  });
  if (session) locals.admin = session;

  // The sign-in page and sign-out endpoint handle both states themselves.
  if (area === 'login' || area === 'logout') return next();

  if (!session) {
    const target = isSafeMethod(request.method) ? `${url.pathname}${url.search}` : '';
    const query = target && target !== '/admin' ? `?next=${encodeURIComponent(target)}` : '';
    return context.redirect(`/admin/login${query}`, isSafeMethod(request.method) ? 302 : 303);
  }

  return next();
}
