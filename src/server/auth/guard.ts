/**
 * The admin guard's building blocks, kept free of Astro and `cloudflare:workers` so they can be
 * unit-tested. `src/middleware.ts` wires them together.
 */
import { createAccessVerifier, type FetchCerts } from './access.ts';
import { API_TOKEN_ACTOR, bearerToken, verifyApiToken } from './api-token.ts';
import { accessSettings, type AuthConfig } from './config.ts';
import { verifySession } from './session.ts';

export type AdminArea = 'page' | 'login' | 'logout' | 'api';

/** What the middleware puts on `Astro.locals.admin` for a signed-in request. */
export interface AdminSession {
  /** 'token' only on /api/v1/admin (Authorization: Bearer <ADMIN_API_TOKEN>). */
  method: 'access' | 'password' | 'token';
  /** Shown in the UI and written to the audit log ('admin' for the shared password,
   * 'api-token' for the API token). */
  actor: string;
  /** Unix seconds; 0 for the API token (no expiry). */
  expiresAt: number;
}

/**
 * Classifies a request path. Returns null for everything outside the admin (the fast path the
 * whole public site takes). The path is decoded and lower-cased first, so `/%61dmin` or `/ADMIN`
 * cannot slip past the guard if the router ever treats them as `/admin`.
 */
export function adminAreaFor(pathname: string): AdminArea | null {
  // Cheap pre-check before any decoding: every admin path contains "admin" or an escape.
  if (!/admin|%/i.test(pathname)) return null;
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: classify the raw path (the router will 400/404 it anyway).
  }
  path = path.toLowerCase().replace(/\/{2,}/g, '/');
  if (/^\/api\/v1\/admin(?:[/.]|$)/.test(path)) return 'api';
  if (!/^\/admin(?:[/.]|$)/.test(path)) return null;
  const rest = path.replace(/\/+$/, '');
  if (rest === '/admin/login') return 'login';
  if (rest === '/admin/logout') return 'logout';
  return 'page';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const isSafeMethod = (method: string) => SAFE_METHODS.has(method.toUpperCase());

/**
 * CSRF defence for state-changing admin requests: the browser must say the request comes from
 * this exact origin. A missing Origin is rejected (every current browser sends one on POST).
 * The session cookie is SameSite=Strict as a second layer.
 */
export function isSameOrigin(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  return origin === url.origin;
}

/** localhost / 127.0.0.1 over plain HTTP: the only place a non-Secure cookie is allowed. */
export function isLocalHttp(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
}

/**
 * `__Host-` cookies must be Secure, Path=/ and have no Domain, so the browser refuses any
 * attempt (e.g. from a sibling subdomain) to overwrite or scope them differently.
 */
export const sessionCookieName = (url: URL) =>
  isLocalHttp(url) ? 'admin_session' : '__Host-admin_session';

export function sessionCookieOptions(url: URL, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: !isLocalHttp(url),
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/**
 * Where to go after signing in. Only same-origin admin paths are allowed (no open redirects,
 * no protocol-relative `//host`, no backslash tricks, never back to the login page).
 */
export function safeNextPath(next: string | null | undefined, origin: string): string {
  if (!next || next.length > 512 || !next.startsWith('/') || next.startsWith('//')) return '/admin';
  if (/[\\\u0000-\u001f]/.test(next)) return '/admin';
  try {
    const target = new URL(next, origin);
    if (target.origin !== origin) return '/admin';
    if (adminAreaFor(target.pathname) !== 'page') return '/admin';
    return `${target.pathname}${target.search}`;
  } catch {
    return '/admin';
  }
}

/** Security headers on every admin response (pages, API, redirects, errors). */
export const ADMIN_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

export function withAdminHeaders(response: Response): Response {
  // Responses from Response.redirect() and fetch() have immutable headers: copy first.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(ADMIN_HEADERS)) out.headers.set(name, value);
  return out;
}

/** Baseline security headers applied to every non-admin response unless already set. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

export function withSecurityHeaders(response: Response): Response {
  let missing = false;
  for (const name of Object.keys(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) {
      missing = true;
      break;
    }
  }
  if (!missing) return response;
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    return response;
  } catch {
    const out = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!out.headers.has(name)) out.headers.set(name, value);
    }
    return out;
  }
}

export interface AuthInput {
  config: AuthConfig;
  request: Request;
  url: URL;
  getCookie: (name: string) => string | undefined;
  now?: Date;
  /** Test hook for the Access certs fetch. */
  fetchCerts?: FetchCerts;
}

/**
 * Returns the session for a signed-in request, or null. Cloudflare Access is checked first; the
 * password session cookie is accepted when password sign-in is configured (alone locally, or as
 * the break-glass backup next to Access in production).
 */
export async function authenticate(input: AuthInput): Promise<AdminSession | null> {
  const { config, request, url, getCookie } = input;
  const now = input.now ?? new Date();

  const access = accessSettings(config);
  if (access) {
    const verifier = createAccessVerifier({
      teamDomain: access.teamDomain,
      aud: access.aud,
      fetchCerts: input.fetchCerts,
      now: () => now,
    });
    const token = request.headers.get('cf-access-jwt-assertion') ?? getCookie('CF_Authorization');
    const identity = token ? await verifier.verify(token) : null;
    if (identity) return { method: 'access', actor: identity.actor, expiresAt: identity.exp };
  }

  if (config.mode === 'password') {
    const payload = await verifySession(
      getCookie(sessionCookieName(url)),
      { secret: config.secret, password: config.password },
      now,
    );
    return payload ? { method: 'password', actor: 'admin', expiresAt: payload.exp } : null;
  }

  return null;
}

export type AdminApiAuth =
  | { ok: true; session: AdminSession }
  | { ok: false; status: 401 | 403; code: 'unauthorized' | 'forbidden'; message: string };

/**
 * Authentication for /api/v1/admin/** (used by the middleware and, again, by the router's admin
 * mount). With an Authorization header, only the bearer token counts (a wrong or unusable one is
 * 401, never a fallback to cookies). Without one, the admin session counts (Access, or the
 * password cookie), and state-changing requests must be same-origin (403 otherwise).
 */
export async function authenticateAdminApi(
  input: AuthInput & { apiToken: string | null },
): Promise<AdminApiAuth> {
  const deny = (status: 401 | 403, message: string): AdminApiAuth => ({
    ok: false,
    status,
    code: status === 401 ? 'unauthorized' : 'forbidden',
    message,
  });
  const bearer = bearerToken(input.request);
  if (bearer !== undefined) {
    if (!input.apiToken) return deny(401, 'API token sign-in is not configured.');
    if (!bearer || !(await verifyApiToken(bearer, input.apiToken))) {
      return deny(401, 'Invalid API token.');
    }
    return { ok: true, session: { method: 'token', actor: API_TOKEN_ACTOR, expiresAt: 0 } };
  }
  if (input.config.mode === 'locked') return deny(401, 'Admin is not configured.');
  if (!isSafeMethod(input.request.method) && !isSameOrigin(input.request, input.url)) {
    return deny(403, 'Cross-origin request blocked.');
  }
  const session = await authenticate(input);
  return session ? { ok: true, session } : deny(401, 'Sign in required.');
}

export function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
