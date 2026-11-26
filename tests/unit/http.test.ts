import { afterAll, describe, expect, it } from 'vitest';
import { endpointList } from '../../src/server/api/v1/registry.ts';
import { get, setup } from './helpers/db.ts';
import { CURATED } from './helpers/counts.ts';

const { db, http } = setup();
afterAll(() => db.close());

describe('HTTP router', () => {
  it('serves the envelope with cache, ETag and CORS headers', async () => {
    const res = await get(http, '/api/v1/stores/youngla.com');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+.*s-maxage=\d+/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('link')).toContain('/stores/youngla.com');
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^W\/".+"$/);
    const body = (await res.json()) as {
      data: { store: { domain: string } };
      meta: { data_as_of: string };
    };
    expect(body.data.store.domain).toBe('youngla.com');
    expect(body.meta.data_as_of).toBe('2026-11-17');

    const again = await get(http, '/api/v1/stores/youngla.com', {
      headers: { 'If-None-Match': etag ?? '' },
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });

  it('coerces query strings to typed input', async () => {
    const res = await get(http, '/api/v1/stores?curated=true&limit=2&sort=apps');
    const body = (await res.json()) as {
      data: { items: Array<{ is_curated: boolean }> };
      meta: { pagination: { total: number } };
    };
    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.meta.pagination.total).toBe(CURATED);
    const search = await get(http, '/api/v1/search?q=pre&kinds=theme,app');
    const s = (await search.json()) as { data: { groups: Array<{ kind: string }> } };
    expect(s.data.groups.map((g) => g.kind)).toEqual(['theme', 'app']);
  });

  it('returns JSON errors with proper status codes', async () => {
    const missing = await get(http, '/api/v1/stores/nope.example');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: 'not_found', message: "Store 'nope.example' not found" },
    });

    const invalid = await get(http, '/api/v1/stores?limit=0');
    expect(invalid.status).toBe(400);
    const err = (await invalid.json()) as {
      error: { code: string; details: Array<{ path: string }> };
    };
    expect(err.error.code).toBe('validation_error');
    expect(err.error.details[0]?.path).toBe('limit');

    const noRoute = await get(http, '/api/v1/nothing-here');
    expect(noRoute.status).toBe(404);
    const wrongMethod = await get(http, '/api/v1/stores', { method: 'DELETE' });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET');
    const admin = await get(http, '/api/v1/admin/stores');
    expect(admin.status).toBe(404);
  });

  it('answers CORS preflight and HEAD', async () => {
    const pre = await get(http, '/api/v1/themes', { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('GET');
    const head = await get(http, '/api/v1/themes', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('lists every endpoint in the index', async () => {
    const res = await get(http, '/api/v1');
    const body = (await res.json()) as { data: { endpoints: Array<{ id: string }> } };
    expect(body.data.endpoints.map((e) => e.id)).toEqual(
      expect.arrayContaining(endpointList.map((e) => e.id)),
    );
  });

  it('publishes a valid OpenAPI 3.1 document covering every route', async () => {
    const res = await get(http, '/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = JSON.parse(await res.text()) as {
      openapi: string;
      paths: Record<
        string,
        Record<
          string,
          {
            operationId: string;
            responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }>;
          }
        >
      >;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe('3.1.0');
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    for (const e of endpointList) {
      expect(doc.paths[`/api/v1${e.path}`]?.[e.method.toLowerCase()]?.operationId).toBe(e.id);
    }
    expect(new Set(ops).size).toBe(ops.length);
    // Every $ref resolves to a component.
    const refs = [
      ...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
    ].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(50);
    for (const ref of refs) expect(doc.components.schemas[ref ?? '']).toBeDefined();
    expect(JSON.stringify(doc)).not.toContain('"$schema"');
  });
});

describe('POST /api/v1/removal-requests', () => {
  const post = (body: BodyInit, type: string, ip = '203.0.113.7') =>
    http(
      new Request('https://test.local/api/v1/removal-requests', {
        method: 'POST',
        body,
        headers: { 'Content-Type': type, 'CF-Connecting-IP': ip },
      }),
    );
  const valid = {
    domain: 'https://www.koh.com/products/x',
    email: 'owner@example.com',
    reason: 'We would like our store removed from the library.',
    scope: 'screenshots',
  };

  it('accepts JSON and stores a hashed IP, never the raw one', async () => {
    const res = await post(JSON.stringify(valid), 'application/json');
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const body = (await res.json()) as {
      data: { reference: string; domain: string; scope: string };
    };
    expect(body.data.reference).toMatch(/^RR-[0-9A-Z]{8}$/);
    expect(body.data).toMatchObject({ domain: 'koh.com', scope: 'screenshots' });
    const row = await db.first<{ ip_hash: string; status: string }>(
      'SELECT ip_hash, status FROM removal_requests WHERE reference = ?',
      [body.data.reference],
    );
    expect(row?.status).toBe('pending');
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(row?.ip_hash).not.toContain('203.0.113.7');
  });

  it('accepts form-encoded bodies', async () => {
    const form = new URLSearchParams({ ...valid, scope: 'store' }).toString();
    const res = await post(form, 'application/x-www-form-urlencoded', '198.51.100.1');
    expect(res.status).toBe(201);
  });

  it('validates fields', async () => {
    const res = await post(
      JSON.stringify({ ...valid, email: 'nope', reason: 'short' }),
      'application/json',
      '198.51.100.2',
    );
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: { details: Array<{ path: string }> } };
    expect(err.error.details.map((d) => d.path).sort()).toEqual(['email', 'reason']);
    const badDomain = await post(
      JSON.stringify({ ...valid, domain: 'not a domain' }),
      'application/json',
      '198.51.100.2',
    );
    expect(badDomain.status).toBe(400);
    const wrongType = await post('x', 'text/plain', '198.51.100.2');
    expect(wrongType.status).toBe(415);
  });

  it('silently drops honeypot submissions', async () => {
    const before = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM removal_requests');
    const res = await post(
      JSON.stringify({ ...valid, website: 'http://spam.example' }),
      'application/json',
      '198.51.100.3',
    );
    expect(res.status).toBe(201);
    const after = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM removal_requests');
    expect(after?.n).toBe(before?.n);
  });

  it('rate-limits by hashed IP', async () => {
    const ip = '192.0.2.99';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await post(
            JSON.stringify({ ...valid, domain: `store${i}.example.com` }),
            'application/json',
            ip,
          )
        ).status,
      );
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    const limited = await post(JSON.stringify(valid), 'application/json', ip);
    expect(limited.headers.get('retry-after')).toBe('3600');
    // Another IP is unaffected.
    expect((await post(JSON.stringify(valid), 'application/json', '192.0.2.100')).status).toBe(201);
  });
});
