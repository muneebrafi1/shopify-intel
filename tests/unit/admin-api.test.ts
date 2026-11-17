/// <reference types="node" />
import { afterAll, describe, expect, it } from 'vitest';
import { createAdminMount } from '../../src/server/admin/api/mount.ts';
import { createApiHandler } from '../../src/server/api/v1/router.ts';
import { apiTokenFrom, MIN_API_TOKEN_LENGTH } from '../../src/server/auth/api-token.ts';
import { readAuthConfig } from '../../src/server/auth/config.ts';
import { signSession } from '../../src/server/auth/session.ts';
import { seededDb, testDeps } from './helpers/db.ts';

// Throwaway test values (never real secrets).
const TOKEN = 't'.repeat(16) + '0123456789abcdef0123456789abcdef';
const ENV = {
  ADMIN_PASSWORD: 'correct horse battery',
  ADMIN_SESSION_SECRET: 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  ADMIN_API_TOKEN: TOKEN,
};
const ORIGIN = 'https://test.local';

const db = seededDb();
const deleted: string[] = [];
const deps = testDeps(db, {
  mediaStore: { delete: async (keys) => void deleted.push(...[keys].flat()) },
});
const mount = (env: Record<string, string | undefined>) =>
  createAdminMount({ authConfig: () => readAuthConfig(env), apiToken: () => apiTokenFrom(env) });
const http = createApiHandler(deps, { mounts: [mount(ENV)] });
afterAll(() => db.close());

type Body = Record<string, unknown>;
const call = async (
  path: string,
  init: {
    method?: string;
    body?: Body;
    token?: string | null;
    headers?: Record<string, string>;
  } = {},
) => {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token !== null) headers.Authorization = `Bearer ${init.token ?? TOKEN}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  const res = await http(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers,
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    }),
  );
  const text = await res.text();
  return { res, json: (text ? JSON.parse(text) : null) as Body & { data: any; error: any } };
};

describe('admin API auth', () => {
  it('401s without credentials, everywhere in the namespace', async () => {
    for (const path of [
      '/admin',
      '/admin/removal-requests',
      '/admin/openapi.json',
      '/admin/does-not-exist',
    ]) {
      const { res, json } = await call(path, { token: null });
      expect(res.status, path).toBe(401);
      expect(json.error.code).toBe('unauthorized');
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    // A wrong method on a real endpoint does not reveal it before auth either: without a token,
    // a write is refused by the same-origin check first.
    const write = await call('/admin/removal-requests', { method: 'DELETE', token: null });
    expect(write.res.status).toBe(403);
    expect(write.json.error.code).toBe('forbidden');
    expect((await call('/admin/removal-requests', { method: 'DELETE' })).res.status).toBe(405);
  });

  it('401s with a wrong, malformed or disabled token', async () => {
    expect((await call('/admin', { token: 'wrong-token' })).res.status).toBe(401);
    expect((await call('/admin', { token: `${TOKEN}x` })).res.status).toBe(401);
    const basic = await call('/admin', { token: null, headers: { Authorization: 'Basic abc' } });
    expect(basic.res.status).toBe(401);
    // A valid session cookie does not rescue a bad bearer token.
    const { token: cookie } = await signSession({
      secret: ENV.ADMIN_SESSION_SECRET,
      password: ENV.ADMIN_PASSWORD,
    });
    const both = await call('/admin', {
      token: 'nope',
      headers: { Cookie: `__Host-admin_session=${cookie}` },
    });
    expect(both.res.status).toBe(401);
    // Token sign-in is off when ADMIN_API_TOKEN is unset or too short.
    expect(apiTokenFrom({})).toBeNull();
    expect(apiTokenFrom({ ADMIN_API_TOKEN: 'x'.repeat(MIN_API_TOKEN_LENGTH - 1) })).toBeNull();
    const off = createApiHandler(deps, { mounts: [mount({ ...ENV, ADMIN_API_TOKEN: undefined })] });
    const res = await off(
      new Request(`${ORIGIN}/api/v1/admin`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
    );
    expect(res.status).toBe(401);
  });

  it('200s with the right token, never cached, no CORS', async () => {
    const { res, json } = await call('/admin');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(json.data.principal).toEqual({ actor: 'api-token', method: 'token' });
    expect(json.data.endpoints.map((e: { id: string }) => e.id)).toContain(
      'adminUpdateRemovalRequest',
    );
    expect((await call('/admin/does-not-exist')).res.status).toBe(404);
  });

  it('accepts the admin session cookie, with a same-origin check on writes', async () => {
    const { token: cookie } = await signSession({
      secret: ENV.ADMIN_SESSION_SECRET,
      password: ENV.ADMIN_PASSWORD,
    });
    const headers = { Cookie: `__Host-admin_session=${cookie}` };
    const read = await call('/admin', { token: null, headers });
    expect(read.res.status).toBe(200);
    expect(read.json.data.principal).toEqual({ actor: 'admin', method: 'password' });
    const body = { dry_run: true };
    const crossSite = await call('/admin/maintenance/purge-removal-records', {
      token: null,
      body,
      headers,
    });
    expect(crossSite.res.status).toBe(403);
    expect(crossSite.json.error.code).toBe('forbidden');
    const sameOrigin = await call('/admin/maintenance/purge-removal-records', {
      token: null,
      body,
      headers: { ...headers, Origin: ORIGIN },
    });
    expect(sameOrigin.res.status).toBe(200);
  });

  it('is locked (401) when nothing is configured', async () => {
    const locked = createApiHandler(deps, { mounts: [mount({})] });
    const res = await locked(new Request(`${ORIGIN}/api/v1/admin`));
    expect(res.status).toBe(401);
  });
});

describe('admin OpenAPI', () => {
  it('keeps admin endpoints out of the public document and index', async () => {
    const pub = (await (await http(new Request(`${ORIGIN}/api/v1/openapi.json`))).json()) as {
      paths: Record<string, Record<string, { operationId: string }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(pub.paths).some((p) => p.includes('/admin'))).toBe(false);
    const ops = Object.values(pub.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(ops.some((id) => id.startsWith('admin'))).toBe(false);
    const ids = Object.keys(pub.components.schemas);
    expect(
      ids.some((id) => /^Admin|CaptureBlock|CaptureStatus|PurgeResult|AuditEntry/.test(id)),
    ).toBe(false);
    const index = (await (await http(new Request(`${ORIGIN}/api/v1`))).json()) as {
      data: { endpoints: Array<{ path: string }> };
    };
    expect(index.data.endpoints.some((e) => e.path.includes('/admin'))).toBe(false);
  });

  it('serves its own document behind the guard', async () => {
    const { res, json } = await call('/admin/openapi.json');
    expect(res.status).toBe(200);
    const doc = json as unknown as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/admin/removal-requests',
        '/api/v1/admin/removal-requests/{id}',
        '/api/v1/admin/maintenance/purge-removal-records',
        '/api/v1/admin/capture-targets',
        '/api/v1/admin/capture-status/{domain}',
      ]),
    );
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual([
      'adminSession',
      'apiToken',
      'cloudflareAccess',
    ]);
    expect(doc.components.schemas.AdminRemovalRequest).toBeDefined();
  });
});

describe('admin API: removal requests and capture blocks', () => {
  const domainOf = async () => {
    const row = await db.first<{ domain: string }>(
      `SELECT domain FROM stores WHERE is_curated = 1 AND status = 'active' ORDER BY list_position LIMIT 1`,
    );
    return row?.domain ?? '';
  };

  it('completing a screenshots removal blocks future captures (and is audited)', async () => {
    const domain = await domainOf();
    // A requester submits the public form.
    const created = await http(
      new Request(`${ORIGIN}/api/v1/removal-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.50' },
        body: JSON.stringify({
          domain,
          email: 'owner@example.com',
          reason: 'Please stop taking screenshots of our store.',
          scope: 'screenshots',
        }),
      }),
    );
    expect(created.status).toBe(201);
    const { data: receipt } = (await created.json()) as { data: { reference: string } };

    const pending = await call('/admin/removal-requests?status=pending');
    expect(pending.res.status).toBe(200);
    const item = pending.json.data.items.find(
      (r: { reference: string }) => r.reference === receipt.reference,
    );
    expect(item).toMatchObject({ domain, scope: 'screenshots', status: 'pending' });
    expect(item.capture_blocked).toBe(false);
    expect((await call(`/admin/capture-status/${domain}`)).json.data.blocked).toBe(false);

    const detail = await call(`/admin/removal-requests/${item.id}`);
    expect(detail.json.data.request.reference).toBe(receipt.reference);
    expect(detail.json.data.capture_block).toBeNull();

    // Approving needs an explicit confirmation.
    const unconfirmed = await call(`/admin/removal-requests/${item.id}`, {
      body: { action: 'approve' },
    });
    expect(unconfirmed.res.status).toBe(400);

    const approved = await call(`/admin/removal-requests/${item.id}`, {
      body: { action: 'approve', confirm: true, note: 'Owner verified by email' },
    });
    expect(approved.res.status).toBe(200);
    expect(approved.json.data).toMatchObject({
      result: 'removal_done',
      deleted_media: 0,
      request: { status: 'done', capture_blocked: true, admin_note: 'Owner verified by email' },
    });

    const status = await call(`/admin/capture-status/https%3A%2F%2Fwww.${domain}%2F`);
    expect(status.json.data).toMatchObject({
      domain,
      blocked: true,
      block: { scope: 'screenshots', reference: receipt.reference, reason: 'removal-request' },
    });
    const targets = await call('/admin/capture-targets?scope=all&limit=500');
    expect(targets.json.data.items.map((t: { domain: string }) => t.domain)).not.toContain(domain);
    const blocks = await call('/admin/capture-blocks');
    expect(blocks.json.data.items.map((b: { domain: string }) => b.domain)).toContain(domain);

    const capture = await call('/admin/jobs', { body: { domain, kind: 'capture' } });
    expect(capture.res.status).toBe(409);
    expect(capture.json.error.details[0].message).toBe('capture_blocked');
    expect((await call('/admin/jobs', { body: { domain, kind: 'rescan' } })).res.status).toBe(201);

    // Handled once only.
    const again = await call(`/admin/removal-requests/${item.id}`, {
      body: { action: 'reject', note: 'Too late' },
    });
    expect(again.res.status).toBe(409);

    const audit = await call(`/admin/audit?target_type=removal&target_id=${item.id}`);
    const actions = audit.json.data.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(['removal.complete', 'removal.approve']);
    expect(audit.json.data.items[1]).toMatchObject({
      actor: 'api-token',
      action: 'removal.approve',
      detail: { scope: 'screenshots', capture_blocked: true },
    });
  });

  it('rejecting needs a note; unknown requests 404', async () => {
    const id = (
      await db.run(
        `INSERT INTO removal_requests (reference, domain, email, reason, scope, status, created_at)
         VALUES ('RR-APITEST1', 'koh.com', 'owner@example.com', 'Please remove us from the site.', 'store', 'pending', '2026-11-17T00:00:00.000Z')`,
      )
    ).lastRowId;
    const noNote = await call(`/admin/removal-requests/${id}`, { body: { action: 'reject' } });
    expect(noNote.res.status).toBe(400);
    const rejected = await call(`/admin/removal-requests/${id}`, {
      body: { action: 'reject', note: 'Not the owner of this store' },
    });
    expect(rejected.json.data).toMatchObject({
      result: 'removal_rejected',
      request: { status: 'rejected', capture_blocked: false },
    });
    expect((await call('/admin/removal-requests/999999')).res.status).toBe(404);
    expect((await call('/admin/removal-requests/abc')).res.status).toBe(400);
  });

  it('purges expired records (dry run first)', async () => {
    await db.run(
      `INSERT INTO removal_requests (reference, domain, email, reason, scope, status, created_at, handled_at)
       VALUES ('RR-OLDAPI01', 'old.example', 'owner@example.com', 'Please remove us from the site.', 'details', 'done', '2023-01-01T00:00:00.000Z', '2023-01-02T00:00:00.000Z')`,
    );
    const dry = await call('/admin/maintenance/purge-removal-records', { body: { dry_run: true } });
    expect(dry.json.data).toMatchObject({ purged: 1, dry_run: true, retention_days: 730 });
    const real = await call('/admin/maintenance/purge-removal-records', { body: {} });
    expect(real.json.data).toMatchObject({ purged: 1, dry_run: false });
    expect(
      await db.first("SELECT id FROM removal_requests WHERE reference = 'RR-OLDAPI01'"),
    ).toBeNull();
  });
});

describe('admin API: catalogue edits', () => {
  it('edits a store, a theme and an app, and writes the audit log', async () => {
    const store = await call('/admin/stores/koh.com', { body: { name: 'KOH', country: 'au' } });
    expect(store.res.status).toBe(200);
    expect(store.json.data).toMatchObject({
      result: 'saved',
      store: { domain: 'koh.com', name: 'KOH', country: 'AU' },
    });
    const same = await call('/admin/stores/koh.com', { body: { name: 'KOH' } });
    expect(same.json.data.result).toBe('no_changes');
    expect((await call('/admin/stores/not-a-store.example', { body: {} })).res.status).toBe(404);

    const theme = await call('/admin/themes/dawn', { body: { price_label: 'Free' } });
    expect(theme.res.status).toBe(200);
    const app = await call('/admin/apps/klaviyo', { body: { category: 'no-such-category' } });
    expect(app.res.status).toBe(400);

    const audit = await call('/admin/audit?target_type=store&target_id=koh.com');
    expect(audit.json.data.items[0]).toMatchObject({ actor: 'api-token', action: 'store.update' });
  });

  it('lists and edits affiliate links', async () => {
    const links = await call('/admin/affiliate-links');
    expect(links.res.status).toBe(200);
    const first = links.json.data.items[0];
    expect(first.url).toMatch(/^https:\/\//);
    const off = await call(`/admin/affiliate-links/${first.id}`, { body: { active: false } });
    expect(off.json.data.result).toBe('saved');
    const bad = await call(`/admin/affiliate-links/${first.id}`, { body: { url: 'http://x' } });
    expect(bad.res.status).toBe(400);
  });
});
