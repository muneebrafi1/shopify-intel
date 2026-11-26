import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

test.describe('MCP server (/mcp)', () => {
  test('supports initialize, tools/list, read-only tools/call and rejects writes', async ({
    request,
  }) => {
    const headers = { 'content-type': 'application/json', 'x-real-ip': '198.51.100.42' };

    const getRes = await request.get('/mcp');
    expect(getRes.status()).toBe(405);
    expect(getRes.headers()['allow']).toContain('POST');

    const init = await request.post('/mcp', {
      headers,
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', clientInfo: { name: 'e2e' } },
      },
    });
    expect(init.status()).toBe(200);
    expect(init.headers()['x-ratelimit-limit']).toBe('60');
    expect(Number(init.headers()['x-ratelimit-remaining'])).toBeLessThan(60);
    expect(await init.json()).toMatchObject({
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
      },
    });

    const list = await request.post('/mcp', {
      headers,
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    expect(list.status()).toBe(200);
    const listJson = (await list.json()) as { result: { tools: { name: string }[] } };
    const names = listJson.result.tools.map((t) => t.name);
    expect(names).toContain('getStore');
    expect(names).toContain('listSections');
    expect(names).not.toContain('createRemovalRequest');

    const storesCall = await request.post('/mcp', {
      headers,
      data: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'listStores', arguments: { limit: 1, facets: false } },
      },
    });
    expect(storesCall.status()).toBe(200);
    const storesEnvelope = JSON.parse(
      ((await storesCall.json()) as { result: { content: { text: string }[] } }).result.content[0]!
        .text,
    ) as { data: { items: { domain: string }[] }; meta: { api_version: string } };
    expect(storesEnvelope.meta.api_version).toBe('v1');
    const domain = storesEnvelope.data.items[0]!.domain;

    const storeCall = await request.post('/mcp', {
      headers,
      data: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'getStore', arguments: { domain } },
      },
    });
    const storeEnvelope = JSON.parse(
      ((await storeCall.json()) as { result: { content: { text: string }[] } }).result.content[0]!
        .text,
    ) as { data: { store: { domain: string } }; meta: { canonical: string } };
    expect(storeEnvelope.data.store.domain).toBe(domain);
    expect(storeEnvelope.meta.canonical).toBe(`/stores/${domain}`);

    const blockedWrite = await request.post('/mcp', {
      headers,
      data: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'createRemovalRequest', arguments: {} },
      },
    });
    expect(await blockedWrite.json()).toMatchObject({ error: { code: -32602 } });
  });

  test('developers page documents the live /mcp server and tools', async ({ page }) => {
    await prepare(page);
    await expectHealthyPage(page, '/developers');
    const mcp = page.locator('#mcp').locator('..');
    await expect(mcp).toContainText('Read-only');
    await expect(mcp).toContainText('/mcp');
    await expect(mcp.locator('.tools__row')).toHaveCount(22);
  });
});
