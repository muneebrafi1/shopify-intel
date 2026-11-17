import { describe, expect, it } from 'vitest';
import { buildSeedFromRoot } from '../../scripts/seed/build.ts';
import { ROOT, seedResult, seededDb } from './helpers/db.ts';

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
