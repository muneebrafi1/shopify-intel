import { describe, expect, it } from 'vitest';
import { buildSeedFromRoot } from '../../scripts/seed/build.ts';
import { createApiClient } from '../../src/server/api/v1/client.ts';
import { affiliateRedirect } from '../../src/server/repo/affiliate.ts';
import { FIXED_NOW, ROOT, seedResult, seededDb, testDeps } from './helpers/db.ts';

describe('seed builder', () => {
  it('is deterministic', () => {
    const again = buildSeedFromRoot(ROOT);
    expect(again.sql).toBe(seedResult().sql);
    expect(again.report.dataVersion).toMatch(/^[0-9a-f]{12}$/);
  });

  it('matches the export counts (detections are the single source of truth)', () => {
    const { report } = seedResult();
    expect(report.warnings.filter((w) => w.startsWith('MISMATCH'))).toEqual([]);
    expect(report.appStoreCounts.klaviyo).toBe(383);
    expect(report.themeStoreCounts.dawn).toBe(20);
    expect(report.counts.stores).toBe(930);
    expect(report.counts.themes).toBe(20);
  });

  it('plans 8 placeholder screenshots per curated store with realistic heights', () => {
    const { report } = seedResult();
    expect(report.shotHeights).toHaveLength(20 * 4 * 2);
    for (const h of report.shotHeights) {
      const [min, max] = h.device === 'desktop' ? [1000, 7500] : [2400, 11000];
      expect(h.height, `${h.domain} ${h.page} ${h.device}`).toBeGreaterThanOrEqual(min);
      expect(h.height, `${h.domain} ${h.page} ${h.device}`).toBeLessThanOrEqual(max);
    }
    const home = report.shotHeights.filter((h) => h.page === 'home');
    for (const h of home.filter((x) => x.device === 'mobile'))
      expect(h.height).toBeGreaterThan(4500);
    for (const h of home.filter((x) => x.device === 'desktop'))
      expect(h.height).toBeGreaterThan(3500);
  });

  it('keeps section geometry consistent', async () => {
    const db = seededDb();
    const bad = await db.all(
      `SELECT s.id FROM sections s JOIN screenshots sh ON sh.id = s.screenshot_id
       WHERE s.y < 0 OR s.height <= 0 OR s.y + s.height > sh.height
          OR s.x < 0 OR s.x + COALESCE(s.w, sh.width) > sh.width`,
    );
    expect(bad).toEqual([]);
    // Desktop two-column rows: gallery and buy box share y and height.
    const rows = await db.all<{ g: number; b: number; gh: number; bh: number }>(
      `SELECT g.y AS g, b.y AS b, g.height AS gh, b.height AS bh FROM sections g
       JOIN sections b ON b.screenshot_id = g.screenshot_id AND b.section_type = 'buy-box'
       WHERE g.section_type = 'product-gallery' AND g.device = 'desktop'`,
    );
    expect(rows).toHaveLength(20);
    for (const r of rows) expect([r.g, r.gh]).toEqual([r.b, r.bh]);
    db.close();
  });

  it('only attributes sections to apps the store actually has', async () => {
    const db = seededDb();
    const orphans = await db.all(
      `SELECT s.id FROM sections s WHERE s.app_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM store_apps sa WHERE sa.store_id = s.store_id AND sa.app_id = s.app_id)`,
    );
    expect(orphans).toEqual([]);
    const flagged = await db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM screenshots WHERE is_placeholder = 0 OR r2_key IS NOT NULL OR captured_at IS NOT NULL',
    );
    expect(flagged?.n).toBe(0);
    db.close();
  });

  it('resolves every teardown note to a section', async () => {
    const db = seededDb();
    const notes = await db.all<{ section_id: number | null }>(
      'SELECT section_id FROM teardown_notes',
    );
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.section_id !== null)).toBe(true);
    db.close();
  });
});

describe('curation overrides (data/curation/overrides.json)', () => {
  it('leaves trustpilot detections unresolved instead of attributing them to Trustgear', async () => {
    const db = seededDb();
    const api = createApiClient(testDeps(db));
    const app = await db.first(
      "SELECT id FROM apps WHERE slug = 'trustpilot' OR name LIKE '%Trustgear%' OR developer = 'Trustgear'",
    );
    expect(app).toBeNull();
    expect(await db.first("SELECT app_id FROM app_aliases WHERE slug = 'trustpilot'")).toBeNull();
    const unresolved = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM store_unresolved_apps WHERE detection_slug = 'trustpilot'",
    );
    expect(unresolved?.n).toBe(37);
    expect(seedResult().report.appStoreCounts.trustpilot).toBeUndefined();
    await expect(api.getApp({ slug: 'trustpilot' })).rejects.toMatchObject({ status: 404 });

    const { data: store } = await api.getStore({ domain: 'youngla.com' });
    expect(store.apps.unresolved.slugs).toContain('trustpilot');
    const names = store.apps.groups.flatMap((g) => g.apps.map((a) => a.name)).join(' ');
    expect(names).not.toMatch(/trustgear/i);
    db.close();
  });

  it('no teardown still claims Trustgear', async () => {
    const db = seededDb();
    const rows = await db.all<{ body: string }>(
      `SELECT body_md AS body FROM teardowns
       UNION ALL SELECT title || ' ' || body FROM teardown_notes`,
    );
    for (const r of rows) expect(r.body).not.toMatch(/trustgear/i);
    db.close();
  });

  it('drops the Hyper affiliate link without renumbering the others', async () => {
    const db = seededDb();
    const api = createApiClient(testDeps(db));
    const { data: hyper } = await api.getTheme({ slug: 'hyper' });
    expect(hyper.theme.cta?.is_affiliate).toBe(false);
    expect(hyper.theme.cta?.href).not.toMatch(/^\/go\//);
    expect(
      await db.first(
        `SELECT id FROM affiliate_links l WHERE l.target_type = 'theme'
           AND l.target_id = (SELECT id FROM themes WHERE slug = 'hyper')`,
      ),
    ).toBeNull();
    // The dropped row was link 4; its id stays unused so /go/4 404s and /go/5 is unchanged.
    const req = new Request('https://test.local/go/4');
    expect((await affiliateRedirect(db, '4', req, FIXED_NOW)).status).toBe(404);
    expect(await db.first('SELECT id FROM affiliate_links WHERE id = 5')).not.toBeNull();
    db.close();
  });
});
