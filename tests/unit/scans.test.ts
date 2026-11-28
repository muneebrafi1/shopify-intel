/// <reference types="node" />
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdminMount } from '../../src/server/admin/api/mount.ts';
import { createApiHandler } from '../../src/server/api/v1/router.ts';
import { apiTokenFrom } from '../../src/server/auth/api-token.ts';
import { readAuthConfig } from '../../src/server/auth/config.ts';
import type { NodeDb } from '../../src/server/db/node-sqlite.ts';
import { rebuildDerived } from '../../src/server/repo/maintenance.ts';
import { ingestScan, type ScanInput } from '../../src/server/repo/scans.ts';
import { seededDb, testDeps } from './helpers/db.ts';

// Throwaway test values (never real secrets).
const TOKEN = 's'.repeat(16) + '0123456789abcdef0123456789abcdef';
const ENV = {
  ADMIN_PASSWORD: 'correct horse battery',
  ADMIN_SESSION_SECRET: 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  ADMIN_API_TOKEN: TOKEN,
};

const scan = (over: Partial<ScanInput> = {}): ScanInput => ({
  domain: 'thesill.com',
  url: 'https://www.thesill.com/',
  scanned_at: '2026-11-26T10:00:00.000Z',
  source: 'vitrine-crawl',
  rules_version: 'storepeek-signatures-v9',
  http_status: 200,
  platform: 'shopify',
  site_name: 'The Sill',
  currency: 'USD',
  theme: { name: 'Horizon', raw_name: 'Horizon', version: '9.9.9', theme_store_id: null },
  apps: [{ slug: 'klaviyo', confidence: 'high' }, { slug: 'not-a-known-app-xyz' }],
  pixels: ['ga4', 'meta-pixel', 'not-a-pixel'],
  ...over,
});

let db: NodeDb;
beforeEach(() => {
  db = seededDb();
});
afterAll(() => db?.close());

const themeRows = () =>
  db.all<{ raw_name: string; version: string | null; replaced_at: string | null }>(
    `SELECT st.raw_name, st.version, st.replaced_at FROM store_themes st
     JOIN stores s ON s.id = st.store_id WHERE s.domain = 'thesill.com' ORDER BY st.id`,
  );

describe('scan ingest', () => {
  it('records the scan and opens a new theme row on a version bump', async () => {
    const before = await themeRows();
    const res = await ingestScan(db, scan());
    expect(res).toMatchObject({ status: 'ingested', theme: 'changed' });
    const after = await themeRows();
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-2)?.replaced_at).toBe('2026-11-26T10:00:00.000Z');
    expect(after.at(-1)).toMatchObject({ version: '9.9.9', replaced_at: null });
    const scanRow = await db.first<{ source: string; rules_version: string }>(
      'SELECT source, rules_version FROM scans WHERE id = ?',
      [(res as { scan_id: number }).scan_id],
    );
    expect(scanRow).toEqual({ source: 'vitrine-crawl', rules_version: 'storepeek-signatures-v9' });
  });

  it('fills a blank theme row in place instead of recording a switch', async () => {
    await db.run(
      `UPDATE store_themes SET theme_id = NULL, raw_name = NULL, version = NULL
       WHERE replaced_at IS NULL AND store_id = (SELECT id FROM stores WHERE domain = 'thesill.com')`,
    );
    const before = await themeRows();
    const res = await ingestScan(db, scan());
    expect(res).toMatchObject({ status: 'ingested', theme: 'new' });
    const after = await themeRows();
    expect(after).toHaveLength(before.length);
    expect(after.at(-1)).toMatchObject({
      raw_name: 'Horizon',
      version: '9.9.9',
      replaced_at: null,
    });
  });

  it('extends the open theme row when nothing changed', async () => {
    await ingestScan(db, scan());
    const res = await ingestScan(db, scan({ scanned_at: '2026-11-27T10:00:00.000Z' }));
    expect(res).toMatchObject({ theme: 'unchanged' });
    expect((await themeRows()).at(-1)).toMatchObject({ replaced_at: null, version: '9.9.9' });
  });

  it('keeps unknown apps unresolved, only names known pixels, never closes unseen apps', async () => {
    const appsBefore = await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM store_apps sa JOIN stores s ON s.id = sa.store_id
       WHERE s.domain = 'thesill.com' AND sa.removed_at IS NULL`,
    );
    const res = await ingestScan(db, scan());
    expect(res).toMatchObject({ unresolved: 1 });
    const unresolved = await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM store_unresolved_apps u JOIN stores s ON s.id = u.store_id
       WHERE s.domain = 'thesill.com' AND u.detection_slug = 'not-a-known-app-xyz'`,
    );
    expect(unresolved?.n).toBe(1);
    const pixels = await db.all<{ pixel: string }>(
      `SELECT p.pixel FROM store_pixels p JOIN stores s ON s.id = p.store_id
       WHERE s.domain = 'thesill.com' ORDER BY p.pixel`,
    );
    expect(pixels.map((p) => p.pixel)).not.toContain('not-a-pixel');
    expect(pixels.map((p) => p.pixel)).toEqual(expect.arrayContaining(['ga4', 'meta-pixel']));
    const appsAfter = await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM store_apps sa JOIN stores s ON s.id = sa.store_id
       WHERE s.domain = 'thesill.com' AND sa.removed_at IS NULL`,
    );
    expect(appsAfter?.n).toBeGreaterThanOrEqual(appsBefore?.n ?? 0);
    // Idempotent: a second identical scan adds nothing.
    const again = await ingestScan(db, scan({ scanned_at: '2026-11-27T10:00:00.000Z' }));
    expect(again).toMatchObject({ apps_added: 0, pixels_added: 0 });
  });

  it('fills a missing name from the storefront, never overwrites an editorial one', async () => {
    await ingestScan(db, scan({ site_name: 'Something Else' }));
    const sill = await db.first<{ name: string }>(
      "SELECT name FROM stores WHERE domain = 'thesill.com'",
    );
    expect(sill?.name).toBe('The Sill');
    const unnamed = await db.first<{ domain: string }>(
      'SELECT domain FROM stores WHERE name IS NULL AND is_curated = 0 ORDER BY id LIMIT 1',
    );
    await ingestScan(db, scan({ domain: unnamed!.domain, site_name: 'Shop Name', theme: null }));
    const filled = await db.first<{ name: string }>('SELECT name FROM stores WHERE domain = ?', [
      unnamed!.domain,
    ]);
    expect(filled?.name).toBe('Shop Name');
  });

  it('refuses unknown and opted-out stores; a non-Shopify scan changes nothing else', async () => {
    expect(await ingestScan(db, scan({ domain: 'no-such-store.example' }))).toMatchObject({
      status: 'unknown-store',
    });
    await db.run(
      "INSERT INTO store_tombstones (domain, reason, created_at) VALUES ('thesill.com', 'test', '2026-11-20T00:00:00Z')",
    );
    expect(await ingestScan(db, scan())).toMatchObject({ status: 'opted-out' });
    await db.run("DELETE FROM store_tombstones WHERE domain = 'thesill.com'");
    const before = await themeRows();
    expect(await ingestScan(db, scan({ platform: 'not-shopify' }))).toMatchObject({
      status: 'not-shopify',
    });
    expect(await themeRows()).toEqual(before);
  });

  it('feeds the derived counts', async () => {
    await ingestScan(db, scan());
    await rebuildDerived(db);
    const s = await db.first<{ current_theme_version: string }>(
      "SELECT current_theme_version FROM stores WHERE domain = 'thesill.com'",
    );
    expect(s?.current_theme_version).toBe('9.9.9');
  });
});

describe('admin scans endpoint', () => {
  const http = () =>
    createApiHandler(testDeps(db), {
      mounts: [
        createAdminMount({
          authConfig: () => readAuthConfig(ENV),
          apiToken: () => apiTokenFrom(ENV),
        }),
      ],
    });
  const post = (body: unknown, token: string | null = TOKEN) =>
    http()(
      new Request('https://test.local/api/v1/admin/scans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  it('needs admin credentials', async () => {
    // No token and no same-origin session: refused (403 from the CSRF check, 401 otherwise).
    expect([401, 403]).toContain((await post({ scans: [scan()] }, null)).status);
  });

  it('ingests one scan per request and writes the audit log', async () => {
    const res = await post({ scans: [scan()] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { results: Array<{ status: string }> } };
    expect(body.data.results).toEqual([expect.objectContaining({ status: 'ingested' })]);
    const audit = await db.first<{ action: string }>(
      "SELECT action FROM admin_audit WHERE action = 'scans.ingest'",
    );
    expect(audit?.action).toBe('scans.ingest');
    expect((await post({ scans: [scan(), scan()] })).status).toBe(400);
  });
});
