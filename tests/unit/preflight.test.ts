import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditConfig, parseJsonc, runSmokeChecks } from '../../scripts/ops/preflight.ts';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);

describe('launch preflight', () => {
  it('parses JSONC without corrupting URLs inside strings', () => {
    const parsed = parseJsonc(`{
      // top comment
      "schema": "https://example.com/a//b",
      /* block
         comment */
      "items": [1, 2,],
    }`) as { schema: string; items: number[] };
    expect(parsed.schema).toBe('https://example.com/a//b');
    expect(parsed.items).toEqual([1, 2]);
  });

  it('passes offline audit on the repo and flags pending launch items in strict mode', () => {
    const normal = auditConfig(ROOT);
    expect(normal.ok).toBe(true);
    expect(normal.checks.find((c) => c.id === 'migrations')?.status).toBe('ok');
    expect(normal.checks.find((c) => c.id === 'env:.env.example')?.status).toBe('ok');

    const strict = auditConfig(ROOT, { strict: true });
    expect(strict.ok).toBe(false);
    const failed = strict.checks.filter((c) => c.status === 'fail').map((c) => c.id);
    expect(failed).toContain('wrangler-d1-id');
    expect(failed).toContain('site-domain');
  });

  it('runs read-only HTTP smoke checks and catches fail-open guards', async () => {
    const okFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      if (path === '/') {
        return new Response('<link rel="canonical"><meta property="og:image">', {
          status: 200,
          headers: { 'content-type': 'text/html', 'x-content-type-options': 'nosniff' },
        });
      }
      if (path === '/robots.txt') {
        return new Response('User-agent: *\nSitemap: https://x/sitemap.xml\n', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      if (path === '/sitemap.xml') {
        return new Response('<sitemapindex></sitemapindex>', {
          status: 200,
          headers: { 'content-type': 'application/xml; charset=utf-8' },
        });
      }
      if (path === '/sitemaps/core.xml' || path === '/sitemaps/sections.xml') {
        return new Response('<urlset></urlset>', {
          status: 200,
          headers: { 'content-type': 'application/xml; charset=utf-8' },
        });
      }
      if (path === '/og-default.png') {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      if (path === '/api/v1/meta') {
        return Response.json({ data: { counts: { stores_curated: 50 } } });
      }
      if (path === '/mcp' && init?.method === 'POST') {
        return Response.json({ result: { tools: Array.from({ length: 22 }, (_, i) => ({ i })) } });
      }
      if (path === '/pro') {
        return new Response('<script type="application/ld+json">{"@type":"FAQPage"}</script>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (path === '/teardowns') {
        return new Response('<h1>Teardowns</h1>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (path === '/admin') {
        return new Response(null, {
          status: 302,
          headers: {
            location: '/admin/login',
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex, nofollow',
            'x-frame-options': 'DENY',
          },
        });
      }
      if (path === '/account') {
        return new Response(null, {
          status: 302,
          headers: {
            location: '/sign-in?next=%2Faccount',
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex',
          },
        });
      }
      return new Response('not found', { status: 404 });
    };

    const passing = await runSmokeChecks('https://example.test', okFetch);
    expect(passing.ok).toBe(true);

    const brokenAdminFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).pathname === '/admin') {
        return new Response('oops open', { status: 200 });
      }
      return okFetch(input, init);
    };
    const failing = await runSmokeChecks('https://example.test', brokenAdminFetch);
    expect(failing.ok).toBe(false);
    expect(failing.checks.find((c) => c.id === 'smoke:admin-guard')?.status).toBe('fail');
  });
});
