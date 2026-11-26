/**
 * MCP server (/mcp): read-only tool catalog derived from API v1, JSON-RPC 2.0 / Streamable HTTP
 * protocol handling, tool calls, error mapping, and D1-backed per-IP rate limiting.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createMcpHandler } from '../../src/server/mcp/server.ts';
import { checkMcpRateLimit, hashMcpIp } from '../../src/server/mcp/rate-limit.ts';
import { mcpToolMap, mcpTools } from '../../src/server/mcp/tools.ts';
import { endpointList } from '../../src/server/api/v1/registry.ts';
import { FIXED_NOW, seededDb, testDeps } from './helpers/db.ts';

const db = seededDb();
afterAll(() => db.close());

const post = (
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  handler(
    new Request('http://127.0.0.1:4321/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.10',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('MCP tool registry', () => {
  it('exposes every public GET endpoint except index and excludes POST endpoints', () => {
    const expected = endpointList.filter((e) => e.method === 'GET' && e.id !== 'index');
    expect(mcpTools.length).toBe(expected.length);
    expect(mcpToolMap.has('createRemovalRequest')).toBe(false);
    expect(mcpToolMap.has('index')).toBe(false);
    for (const tool of mcpTools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.$schema).toBeUndefined();
    }
  });
});

describe('MCP HTTP & JSON-RPC protocol', () => {
  const handler = createMcpHandler(testDeps(db), {
    rateLimit: { maxRequests: 100, windowSeconds: 60 },
  });

  it('handles OPTIONS preflight and returns 405 for GET / DELETE', async () => {
    const opt = await handler(new Request('http://127.0.0.1:4321/mcp', { method: 'OPTIONS' }));
    expect(opt.status).toBe(204);
    expect(opt.headers.get('access-control-allow-origin')).toBe('*');

    const get = await handler(new Request('http://127.0.0.1:4321/mcp', { method: 'GET' }));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toContain('POST');

    const del = await handler(new Request('http://127.0.0.1:4321/mcp', { method: 'DELETE' }));
    expect(del.status).toBe(405);
  });

  it('requires application/json and rejects oversized or malformed payloads', async () => {
    const badCt = await handler(
      new Request('http://127.0.0.1:4321/mcp', { method: 'POST', body: '{}' }),
    );
    expect(badCt.status).toBe(415);

    const badJson = await post(handler, '{not json');
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toMatchObject({ error: { code: -32700 } });

    const tooBig = await post(handler, 'x'.repeat(40 * 1024));
    expect(tooBig.status).toBe(413);
  });

  it('negotiates protocolVersion on initialize and accepts notifications with 202', async () => {
    const init = await post(handler, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } },
    });
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { version: '1.0.0' },
      },
    });

    const fallback = await post(handler, {
      jsonrpc: '2.0',
      id: 'v-old',
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    });
    expect((await fallback.json()).result.protocolVersion).toBe('2025-03-26');

    const notif = await post(handler, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(notif.status).toBe(202);
    expect(await notif.text()).toBe('');
  });

  it('lists tools and answers ping', async () => {
    const ping = await post(handler, { jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(await ping.json()).toEqual({ jsonrpc: '2.0', id: 2, result: {} });

    const list = await post(handler, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const json = await list.json();
    expect(json.result.tools.length).toBe(mcpTools.length);
    const getStore = json.result.tools.find((t: { name: string }) => t.name === 'getStore');
    expect(getStore.inputSchema.required).toEqual(['domain']);

    const unknown = await post(handler, { jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect(await unknown.json()).toMatchObject({ id: 4, error: { code: -32601 } });
  });

  it('executes read-only tools and wraps envelope with provenance', async () => {
    const searchRes = await post(handler, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'search', arguments: { q: 'prestige' } },
    });
    const searchJson = await searchRes.json();
    const payload = JSON.parse(searchJson.result.content[0].text);
    expect(payload.meta.api_version).toBe('v1');
    expect(payload.meta.sources).toBeDefined();
    expect(
      payload.data.groups.some(
        (g: { kind: string; items: unknown[] }) => g.kind === 'theme' && g.items.length > 0,
      ),
    ).toBe(true);

    const storesRes = await post(handler, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'listStores', arguments: { limit: 2, facets: false } },
    });
    const storesPayload = JSON.parse((await storesRes.json()).result.content[0].text);
    expect(storesPayload.data.items).toHaveLength(2);
    const domain = storesPayload.data.items[0].domain;

    const storeRes = await post(handler, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'getStore', arguments: { domain } },
    });
    const storePayload = JSON.parse((await storeRes.json()).result.content[0].text);
    expect(storePayload.data.store.domain).toBe(domain);
    expect(storePayload.meta.canonical).toBe(`/stores/${domain}`);
  });

  it('returns tool errors with isError=true and unknown tools with -32602', async () => {
    const missing = await post(handler, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'getStore', arguments: { domain: 'does-not-exist.example' } },
    });
    const missingJson = await missing.json();
    expect(missingJson.result.isError).toBe(true);
    expect(JSON.parse(missingJson.result.content[0].text)).toMatchObject({
      error: { code: 'not_found' },
    });

    const invalid = await post(handler, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'listStores', arguments: { limit: 999 } },
    });
    const invalidJson = await invalid.json();
    expect(invalidJson.result.isError).toBe(true);
    expect(JSON.parse(invalidJson.result.content[0].text)).toMatchObject({
      error: { code: 'validation_error' },
    });

    const badTool = await post(handler, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'createRemovalRequest', arguments: {} },
    });
    expect(await badTool.json()).toMatchObject({
      id: 22,
      error: { code: -32602, message: 'Unknown tool: createRemovalRequest' },
    });
  });

  it('supports JSON-RPC batches', async () => {
    const res = await post(handler, [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getMeta' } },
    ]);
    expect(res.status).toBe(200);
    const replies = await res.json();
    expect(replies).toHaveLength(2);
    expect(replies[0]).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(replies[1].id).toBe(2);
  });
});

describe('MCP rate limiting', () => {
  it('hashes IPs with salt and isolates limits per IP and window', async () => {
    const testDb = seededDb();
    try {
      const h1 = await hashMcpIp('198.51.100.1', 'salt-a');
      const h2 = await hashMcpIp('198.51.100.1', 'salt-b');
      expect(h1).toHaveLength(32);
      expect(h1).not.toBe(h2);
      expect(h1).not.toContain('198.51.100.1');

      const r1 = await checkMcpRateLimit(testDb, '198.51.100.1', {
        salt: 's',
        now: FIXED_NOW,
        maxRequests: 2,
        windowSeconds: 60,
      });
      const r2 = await checkMcpRateLimit(testDb, '198.51.100.1', {
        salt: 's',
        now: FIXED_NOW,
        maxRequests: 2,
        windowSeconds: 60,
      });
      const r3 = await checkMcpRateLimit(testDb, '198.51.100.1', {
        salt: 's',
        now: FIXED_NOW,
        maxRequests: 2,
        windowSeconds: 60,
      });
      expect(r1).toMatchObject({ allowed: true, remaining: 1 });
      expect(r2).toMatchObject({ allowed: true, remaining: 0 });
      expect(r3).toMatchObject({ allowed: false, remaining: 0, retryAfter: 60 });

      // Different IP is unaffected.
      const other = await checkMcpRateLimit(testDb, '198.51.100.2', {
        salt: 's',
        now: FIXED_NOW,
        maxRequests: 2,
        windowSeconds: 60,
      });
      expect(other.allowed).toBe(true);

      // Next minute window resets and prunes old buckets.
      const later = new Date(FIXED_NOW.getTime() + 180_000);
      const nextWin = await checkMcpRateLimit(testDb, '198.51.100.1', {
        salt: 's',
        now: later,
        maxRequests: 2,
        windowSeconds: 60,
      });
      expect(nextWin).toMatchObject({ allowed: true, remaining: 1 });
      const rows = await testDb.all<{ bucket: number }>('SELECT bucket FROM mcp_rate_limits');
      expect(rows.every((r) => r.bucket >= Math.floor(later.getTime() / 60_000) - 2)).toBe(true);
    } finally {
      testDb.close();
    }
  });

  it('returns HTTP 429 with Retry-After from the handler when exceeded', async () => {
    const testDb = seededDb();
    try {
      let now = new Date('2026-11-17T12:00:15.000Z');
      const handler = createMcpHandler(testDeps(testDb, { now: () => now }), {
        rateLimit: { maxRequests: 2, windowSeconds: 60 },
      });
      const a = await post(
        handler,
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { 'cf-connecting-ip': '198.51.100.7' },
      );
      const b = await post(
        handler,
        { jsonrpc: '2.0', id: 2, method: 'ping' },
        { 'cf-connecting-ip': '198.51.100.7' },
      );
      const c = await post(
        handler,
        { jsonrpc: '2.0', id: 3, method: 'ping' },
        { 'cf-connecting-ip': '198.51.100.7' },
      );
      expect(a.status).toBe(200);
      expect(a.headers.get('x-ratelimit-remaining')).toBe('1');
      expect(b.status).toBe(200);
      expect(b.headers.get('x-ratelimit-remaining')).toBe('0');
      expect(c.status).toBe(429);
      expect(c.headers.get('retry-after')).toBe('45');
      expect(await c.json()).toMatchObject({ error: { code: -32029 } });
    } finally {
      testDb.close();
    }
  });
});
