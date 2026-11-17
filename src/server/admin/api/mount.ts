/**
 * The admin API namespace for the router: `createApiHandler(deps, { mounts:
 * [createAdminMount(...)] })` serves /api/v1/admin/* (no caching, no CORS) and its own OpenAPI
 * document at /api/v1/admin/openapi.json, all behind the guard below. The middleware checks the
 * same credentials first; this guard re-checks them so the namespace is safe even if it is ever
 * mounted somewhere the middleware does not run.
 *
 * Accepted credentials (any one):
 *   - Cloudflare Access (primary in production): the Access JWT header or cookie.
 *   - The password session cookie (local, and break-glass next to Access).
 *   - Authorization: Bearer <ADMIN_API_TOKEN> (scripts, MCP). Constant-time compare; off when
 *     the variable is unset. Bearer requests skip the same-origin check; cookie ones need it.
 */
import { SITE_NAME } from '../../../config/site.ts';
import { ApiError } from '../../api/v1/errors.ts';
import { buildOpenApiDocument, type Json } from '../../api/v1/openapi.ts';
import type { Mount } from '../../api/v1/router.ts';
import type { FetchCerts } from '../../auth/access.ts';
import type { AuthConfig } from '../../auth/config.ts';
import { authenticateAdminApi } from '../../auth/guard.ts';
import { ADMIN_API_BASE, adminEndpointList } from './endpoints.ts';
import { adminSchemaRegistry } from './schemas.ts';

export interface AdminMountOptions {
  authConfig: () => AuthConfig;
  /** ADMIN_API_TOKEN when token sign-in is enabled, else null (see apiTokenFrom). */
  apiToken: () => string | null;
  /** Test hooks. */
  fetchCerts?: FetchCerts;
  now?: () => Date;
}

/** Minimal Cookie header reader (name → value). */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

let doc: Json | null = null;

/** The admin OpenAPI document. Built from the admin registry only; never public. */
export function adminOpenApiDocument(): Json {
  doc ??= buildOpenApiDocument({
    endpoints: adminEndpointList,
    registry: adminSchemaRegistry,
    basePath: ADMIN_API_BASE,
    title: `${SITE_NAME} admin API`,
    description:
      'Protected. Removal requests, capture blocks, retention and the admin edits, for scripts and the MCP server. Every change is written to the audit log. Not part of the public API (/api/v1/openapi.json).',
    extraErrors: ['401', '403', '409'],
    security: {
      schemes: {
        apiToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'ADMIN_API_TOKEN (scripts, MCP). Disabled when unset.',
        },
        cloudflareAccess: {
          type: 'apiKey',
          in: 'header',
          name: 'Cf-Access-Jwt-Assertion',
          description: 'Added by Cloudflare Access in front of the admin (primary sign-in).',
        },
        adminSession: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-admin_session',
          description:
            'Password sign-in at /admin/login (break-glass). Writes must be same-origin.',
        },
      },
      requirement: [{ apiToken: [] }, { cloudflareAccess: [] }, { adminSession: [] }],
    },
  });
  return doc;
}

export function createAdminMount(opts: AdminMountOptions): Mount {
  return {
    prefix: 'admin',
    endpoints: adminEndpointList,
    openapi: adminOpenApiDocument,
    guard: async (request) => {
      const url = new URL(request.url);
      const auth = await authenticateAdminApi({
        config: opts.authConfig(),
        apiToken: opts.apiToken(),
        request,
        url,
        getCookie: (name) => readCookie(request, name),
        ...(opts.fetchCerts ? { fetchCerts: opts.fetchCerts } : {}),
        ...(opts.now ? { now: opts.now() } : {}),
      });
      if (!auth.ok) return new ApiError(auth.code, auth.message);
      return { actor: auth.session.actor, method: auth.session.method };
    },
  };
}
