import { describe, expect, it } from 'vitest';
import {
  buildCoreSitemap,
  buildSectionsSitemap,
  buildSitemapIndex,
} from '../../src/server/repo/sitemap.ts';
import { seededDb } from './helpers/db.ts';

const ORIGIN = 'https://vitrine.example';
const extractLocs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

describe('XML sitemaps', () => {
  it('builds a sitemap index pointing at core and sections sitemaps', async () => {
    const db = seededDb();
    try {
      const xml = await buildSitemapIndex(db, ORIGIN);
      expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(extractLocs(xml)).toEqual([
        `${ORIGIN}/sitemaps/core.xml`,
        `${ORIGIN}/sitemaps/sections.xml`,
      ]);
      expect(xml).toContain('<lastmod>2026-11-17</lastmod>');
    } finally {
      db.close();
    }
  });

  it('includes indexable core routes and excludes noindex, private and detected-only stores', async () => {
    const db = seededDb();
    try {
      const xml = await buildCoreSitemap(db, ORIGIN);
      const locs = extractLocs(xml);
      expect(new Set(locs).size).toBe(locs.length);
      expect(locs).toContain(`${ORIGIN}/`);
      expect(locs).toContain(`${ORIGIN}/pro`);
      expect(locs).toContain(`${ORIGIN}/stores/youngla.com`);
      expect(locs).toContain(`${ORIGIN}/themes/dawn`);
      expect(locs).toContain(`${ORIGIN}/apps/klaviyo`);
      expect(locs).toContain(`${ORIGIN}/apps/categories/reviews`);
      expect(locs).toContain(`${ORIGIN}/sections/hero`);
      expect(locs).toContain(`${ORIGIN}/teardowns/youngla`);
      expect(locs).toContain(`${ORIGIN}/compare/judgeme-vs-loox`);
      expect(locs).toContain(`${ORIGIN}/alternatives/klaviyo`);

      for (const excluded of ['/admin', '/account', '/search', '/sign-in', '/design-system']) {
        expect(locs).not.toContain(`${ORIGIN}${excluded}`);
      }

      // Detected-only stores (without screenshots) have noindex on /stores/<domain> and stay out.
      const uncaptured = await db.first<{ domain: string }>(
        `SELECT domain FROM stores WHERE status = 'active'
           AND NOT EXISTS (SELECT 1 FROM screenshots sh WHERE sh.store_id = stores.id AND sh.is_current = 1)
         LIMIT 1`,
      );
      expect(uncaptured).not.toBeNull();
      expect(locs).not.toContain(`${ORIGIN}/stores/${uncaptured!.domain}`);

      // Removed stores are excluded too.
      await db.run("UPDATE stores SET status = 'opted_out' WHERE domain = 'youngla.com'");
      const after = extractLocs(await buildCoreSitemap(db, ORIGIN));
      expect(after).not.toContain(`${ORIGIN}/stores/youngla.com`);
    } finally {
      db.close();
    }
  });

  it('builds the sections sitemap for current sections on active stores only', async () => {
    const db = seededDb();
    try {
      const xml = await buildSectionsSitemap(db, ORIGIN);
      const locs = extractLocs(xml);
      expect(locs.length).toBeGreaterThan(100);
      expect(
        locs.every((u) => /^https:\/\/vitrine\.example\/sections\/[a-z-]+\/\d+$/.test(u)),
      ).toBe(true);
      const sample = await db.first<{ id: number; section_type: string; store_id: number }>(
        `SELECT s.id, s.section_type, s.store_id FROM sections s
         JOIN screenshots sh ON sh.id = s.screenshot_id AND sh.is_current = 1
         JOIN stores st ON st.id = s.store_id AND st.status = 'active'
         LIMIT 1`,
      );
      expect(sample).not.toBeNull();
      const target = `${ORIGIN}/sections/${sample!.section_type}/${sample!.id}`;
      expect(locs).toContain(target);

      await db.run("UPDATE stores SET status = 'opted_out' WHERE id = ?", [sample!.store_id]);
      const after = extractLocs(await buildSectionsSitemap(db, ORIGIN));
      expect(after).not.toContain(target);
    } finally {
      db.close();
    }
  });
});
