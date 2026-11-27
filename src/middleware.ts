/**
 * Site-wide middleware. It guards the admin and loads the visitor on account pages; every other
 * request goes straight to `next()` after cheap path checks (public pages stay user-agnostic, so
 * they can be cached by the CDN).
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
import { queryMeter } from './server/db/d1.ts';
import { defineMiddleware } from 'astro:middleware';
import {
  adminAreaFor,
  authenticate,
  authenticateAdminApi,
  isSafeMethod,
  isSameOrigin,
  jsonError,
  withAdminHeaders,
  withSecurityHeaders,
  type AdminArea,
} from './server/auth/guard.ts';

// Set at build time for pre-launch previews (PUBLIC_NOINDEX=1): noindex on every response.
const NOINDEX = import.meta.env.PUBLIC_NOINDEX === '1';

export const onRequest = defineMiddleware(async (context, next) => {
  if (!import.meta.env.DEV) return withSecurityHeaders(await route(context, next), NOINDEX);
  // Dev only: report D1 usage per request (free plan limit: 50 queries per invocation).
  queryMeter.calls = 0;
  queryMeter.statements = 0;
  const response = withSecurityHeaders(await route(context, next), NOINDEX);
  const used = `${queryMeter.calls}/${queryMeter.statements}`;
  try {
    response.headers.set('x-d1-queries', used);
  } catch {
    // Immutable headers (e.g. redirects): nothing to annotate.
  }
  if (queryMeter.calls > 45) console.warn(`[d1] ${context.url.pathname}: ${used} queries`);
  return response;
});

async function route(context: Ctx, next: Next): Promise<Response> {
  const userArea = userAreaFor(context.url.pathname);
  if (userArea !== null) return guardUser(context, next, userArea);
  const area = adminAreaFor(context.url.pathname);
  if (area === null) return cachedPublic(context, next);
  return withAdminHeaders(await guardAdmin(context, next, area));
}

/** Repeat public GETs from caches.default so SSR does not 500 under modest concurrency. */
async function cachedPublic(context: Ctx, next: Next): Promise<Response> {
  const request = context.request;
  if (request.method !== 'GET') return next();
  const cookie = request.headers.get('Cookie') ?? '';
  if (/(?:^|;\s*)(?:session|__session|sid|auth|cf_auth)=/i.test(cookie)) return next();

  const key = new Request(request.url, { method: 'GET' });
  try {
    const hit = await caches.default.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('X-Vitrine-Cache', 'HIT');
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
  } catch {
    // caches.default is missing in some test / dev runtimes.
  }

  const res = await next();
  const cc = res.headers.get('Cache-Control') ?? '';
  const cacheable =
    res.status === 200 &&
    !res.headers.has('Set-Cookie') &&
    !/no-store|private|no-cache/i.test(cc) &&
    /(?:s-maxage|max-age)=[1-9]\d*/i.test(cc);
  if (!cacheable) return res;
  const headers = new Headers(res.headers);
  headers.set('X-Vitrine-Cache', 'MISS');
  const miss = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  try {
    await caches.default.put(key, miss.clone());
  } catch {
    // Ignore cache write failures; the response is still valid.
  }
  return miss;
}

/**
 * Visitor accounts. 'account' (/account/**) needs a signed-in user; 'auth' (/auth/**, /sign-in)
 * only loads one. Both: non-GET must come from this origin (CSRF, on top of SameSite=Lax), and
 * responses are never cached.
 */
type UserArea = 'account' | 'auth';
function userAreaFor(pathname: string): UserArea | null {
  // Example boards are a public preview of what boards look like.
  if (pathname.startsWith('/account/boards/example-')) return 'auth';
  if (pathname === '/account' || pathname.startsWith('/account/')) return 'account';
  if (pathname.startsWith('/auth/') || pathname === '/sign-in') return 'auth';
  return null;
}

function withUserHeaders(response: Response): Response {
  try {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
  } catch {
    const out = new Response(response.body, response);
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  }
}

async function guardUser(context: Ctx, next: Next, area: UserArea): Promise<Response> {
  const { request, url, cookies, locals } = context;
  if (!isSafeMethod(request.method) && !isSameOrigin(request, url)) {
    return withUserHeaders(
      new Response('Cross-origin request blocked.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }
  // Loaded lazily so the public fast path never touches account code or bindings.
  const [{ accountDb }, { userForSession, SESSION_COOKIE, SIGNED_IN_COOKIE }] = await Promise.all([
    import('./server/account/env.ts'),
    import('./server/account/sessions.ts'),
  ]);
  const token = cookies.get(SESSION_COOKIE)?.value;
  locals.user = token ? await userForSession(accountDb(), token) : null;
  if (token && !locals.user) {
    cookies.delete(SESSION_COOKIE, { path: '/' });
    cookies.delete(SIGNED_IN_COOKIE, { path: '/' });
  }
  if (area === 'account' && !locals.user) {
    if (!isSafeMethod(request.method)) return withUserHeaders(context.redirect('/sign-in', 303));
    const target = `${url.pathname}${url.search}`;
    return withUserHeaders(context.redirect(`/sign-in?next=${encodeURIComponent(target)}`, 302));
  }
  return withUserHeaders(await next());
}

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
