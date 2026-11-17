/**
 * HTTP router for /api/v1/*. Matches a request to an endpoint definition, turns path + query
 * (GET) or body (POST, JSON or form-encoded) into the endpoint's input object, runs it through
 * the shared executor and writes the envelope with caching, ETag and CORS headers.
 *
 * Protected namespaces (e.g. admin) are mounted with a guard: `createApiHandler(deps, { mounts:
 * [{ prefix: 'admin', endpoints, guard }] })` serves them at /api/v1/admin/... with no caching
 * and no CORS. The guard runs before input parsing and must return an ApiError to deny.
 */
import { z } from 'zod';
import { SITE_URL } from '../../../config/site.ts';
import type { Ctx } from './context.ts';
import type { EndpointDef } from './define.ts';
import { ApiError, isApiError } from './errors.ts';
import { buildCtx, createRuntime, execute, type ApiDeps, type Runtime } from './execute.ts';
import { openApiDocument } from './openapi.ts';
import { endpointList } from './registry.ts';
import type { ErrorResponse } from './schemas/envelope.ts';

export const API_BASE = '/api/v1';
/** Bump when response shapes change without a data change, to invalidate ETags. */
export const API_REVISION = '1';
const MAX_BODY_BYTES = 16 * 1024;

const PUBLIC_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag, Link',
  'Access-Control-Max-Age': '86400',
};

export interface Mount {
  prefix: string;
  endpoints: readonly EndpointDef[];
  guard: (request: Request, ctx: Ctx) => Promise<ApiError | null>;
}

export interface RouterOptions {
  mounts?: readonly Mount[];
}

interface Route {
  def: EndpointDef;
  pattern: RegExp;
  params: string[];
  mount: Mount | null;
}

function compile(def: EndpointDef, mount: Mount | null): Route {
  const params: string[] = [];
  const prefix = mount ? `/${mount.prefix}` : '';
  const source = `${prefix}${def.path}`.replace(/\{([a-z_]+)\}/g, (_m, name: string) => {
    params.push(name);
    return '([^/]+)';
  });
  return { def, pattern: new RegExp(`^${source}/?$`), params, mount };
}

// ---------------------------------------------------------------------------------------------
// Input coercion: query strings and form fields are strings; the schemas are typed.
// ---------------------------------------------------------------------------------------------
function baseType(field: z.ZodType): z.ZodType {
  let s = field;
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) {
    s = s.unwrap() as z.ZodType;
  }
  return s;
}

export function coerceFields(
  schema: z.ZodObject,
  source: ReadonlyMap<string, string[]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const values = (source.get(key) ?? []).filter((v) => v !== '');
    if (values.length === 0) continue;
    const base = baseType(field as z.ZodType);
    const last = values[values.length - 1] ?? '';
    if (base instanceof z.ZodArray) {
      out[key] = values
        .flatMap((v) => v.split(','))
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (base instanceof z.ZodNumber) {
      out[key] = Number(last); // NaN fails validation with a clear message
    } else if (base instanceof z.ZodBoolean) {
      out[key] = ['true', '1', 'yes'].includes(last)
        ? true
        : ['false', '0', 'no'].includes(last)
          ? false
          : last;
    } else {
      out[key] = last;
    }
  }
  return out;
}

const toMultiMap = (entries: Iterable<[string, string]>) => {
  const map = new Map<string, string[]>();
  for (const [k, v] of entries) map.set(k, [...(map.get(k) ?? []), v]);
  return map;
};

async function readBody(request: Request, schema: z.ZodObject): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new ApiError('payload_too_large', 'Request body too large');
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type === 'application/json') {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES)
      throw new ApiError('payload_too_large', 'Request body too large');
    let body: unknown;
    try {
      body = JSON.parse(text || '{}');
    } catch {
      throw new ApiError('bad_request', 'Body is not valid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError('bad_request', 'Body must be a JSON object');
    }
    return body as Record<string, unknown>;
  }
  if (type === 'application/x-www-form-urlencoded') {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES)
      throw new ApiError('payload_too_large', 'Request body too large');
    return coerceFields(schema, toMultiMap(new URLSearchParams(text)));
  }
  if (type === 'multipart/form-data') {
    const form = await request.formData();
    const entries: Array<[string, string]> = [];
    form.forEach((v, k) => {
      if (typeof v === 'string') entries.push([k, v]);
    });
    return coerceFields(schema, toMultiMap(entries));
  }
  throw new ApiError('unsupported_media_type', 'Send JSON or a form-encoded body');
}

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------
function respond(body: unknown, status: number, headers: Record<string, string>, head = false) {
  return new Response(head || status === 304 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function errorResponse(err: unknown, publicRoute: boolean): Response {
  const apiErr = isApiError(err)
    ? err
    : new ApiError('internal_error', 'Something went wrong. Please try again.');
  if (!isApiError(err)) console.error('[api] unhandled error', err);
  const body: ErrorResponse = { error: { code: apiErr.code, message: apiErr.message } };
  if (apiErr.details) body.error.details = apiErr.details;
  return respond(body, apiErr.status, {
    'Cache-Control': 'no-store',
    ...(publicRoute ? CORS : {}),
    ...apiErr.headers,
  });
}

const clientIp = (request: Request) =>
  request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? null;

// ---------------------------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------------------------
export function createApiHandler(
  deps: ApiDeps,
  opts: RouterOptions = {},
): (request: Request) => Promise<Response> {
  const rt: Runtime = createRuntime(deps);
  const routes = [
    ...endpointList.map((def) => compile(def, null)),
    ...(opts.mounts ?? []).flatMap((m) => m.endpoints.map((def) => compile(def, m))),
  ];

  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(API_BASE))
      return errorResponse(new ApiError('not_found', 'Not found'), true);
    const path = url.pathname.slice(API_BASE.length) || '';
    const method = request.method.toUpperCase();
    const isHead = method === 'HEAD';

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      if (path === '/openapi.json' && (method === 'GET' || isHead)) {
        const data = await rt.dataInfo(deps.db, Date.now());
        return respond(
          openApiDocument(),
          200,
          {
            'Cache-Control': PUBLIC_CACHE,
            ETag: `W/"openapi-${API_REVISION}-${data.dataVersion}"`,
            ...CORS,
          },
          isHead,
        );
      }

      const matches = routes
        .map((route) => ({ route, m: route.pattern.exec(path === '/' ? '' : path) }))
        .filter((x): x is { route: Route; m: RegExpExecArray } => x.m !== null);
      if (matches.length === 0) throw new ApiError('not_found', `No endpoint at ${url.pathname}`);
      const effective = isHead ? 'GET' : method;
      const hit = matches.find((x) => x.route.def.method === effective);
      if (!hit) {
        const allow = [...new Set(matches.map((x) => x.route.def.method))].join(', ');
        throw new ApiError('method_not_allowed', `Use ${allow}`, { headers: { Allow: allow } });
      }
      const { route, m } = hit;
      const publicRoute = route.mount === null && route.def.cache === 'public';

      try {
        if (route.mount) {
          const denied = await route.mount.guard(
            request,
            await buildCtx(rt, { ip: clientIp(request) }),
          );
          if (denied) throw denied;
        }

        const pathValues = new Map<string, string[]>();
        route.params.forEach((name, i) =>
          pathValues.set(name, [decodeURIComponent(m[i + 1] ?? '')]),
        );
        const input =
          route.def.method === 'GET'
            ? coerceFields(
                route.def.input,
                new Map([...toMultiMap(url.searchParams), ...pathValues]),
              )
            : {
                ...(await readBody(request, route.def.input)),
                ...coerceFields(route.def.input, pathValues),
              };

        let etag: string | null = null;
        if (publicRoute) {
          const data = await rt.dataInfo(deps.db, Date.now());
          etag = `W/"${API_REVISION}-${data.dataVersion}"`;
          if (request.headers.get('if-none-match') === etag) {
            return respond(null, 304, { ETag: etag, 'Cache-Control': PUBLIC_CACHE, ...CORS });
          }
        }

        const result = await execute(rt, route.def, input, { ip: clientIp(request) });
        const headers: Record<string, string> = { ...result.headers };
        if (publicRoute && etag) {
          Object.assign(headers, CORS, { 'Cache-Control': PUBLIC_CACHE, ETag: etag });
        } else {
          headers['Cache-Control'] = 'no-store';
        }
        if (result.envelope.meta.canonical) {
          headers.Link = `<${SITE_URL}${result.envelope.meta.canonical}>; rel="canonical"`;
        }
        return respond(result.envelope, result.status, headers, isHead);
      } catch (err) {
        return errorResponse(err, publicRoute);
      }
    } catch (err) {
      return errorResponse(err, true);
    }
  };
}
