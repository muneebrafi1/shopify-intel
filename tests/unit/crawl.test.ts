/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { cleanSiteName } from '../../scripts/crawl/collect.ts';
import { pageTokens, parseThemeStorePage } from '../../scripts/crawl/theme-store.ts';
import { loadDataInfo } from '../../src/server/api/v1/context.ts';
import { ingestScan } from '../../src/server/repo/scans.ts';
import { seededDb } from './helpers/db.ts';

// A small synthetic page in the Theme Store's layout (not a copy of a real page).
const PAGE = `<html><head><style>.x{color:red}</style><script>var a = {b: 1};</script></head><body>
  <h1>Example</h1><p>Version 3.2.1</p><p>88% positive</p><p>1,204 reviews for all presets</p>
  <p>WHAT'S INCLUDED</p><h2>Features</h2>
  <h3>Cart and checkout</h3><ul><li>Quick buy</li><li>Sticky cart</li></ul>
  <h3>Merchandising</h3><ul><li>Combined listings</li><li>Shopify Plus</li><li>Quick buy</li></ul>
  <h3>Cart and checkout</h3><ul><li>Quick buy</li></ul>
  <h2>Presets</h2><p>Example comes with 2 ready-made designs to choose from.</p>
  <span>Bold</span><span>Calm &amp; quiet</span><svg><text>icon</text></svg>
</body></html>`;

describe('Theme Store page parser', () => {
  it('reads visible text only', () => {
    const t = pageTokens(PAGE);
    expect(t).toContain('Calm & quiet');
    expect(t.join(' ')).not.toMatch(/color:red|var a|icon/);
  });

  it('reads presets, features (first copy only), version and reviews', () => {
    const f = parseThemeStorePage(PAGE, 'Example');
    expect(f.presets).toEqual(['Bold', 'Calm & quiet']);
    expect(f.features).toEqual([
      { group: 'Cart and checkout', items: ['Quick buy', 'Sticky cart'] },
      { group: 'Merchandising', items: ['Combined listings', 'Quick buy'] },
    ]);
    expect(f.version).toBe('3.2.1');
    expect(f.reviews).toEqual({ positive_pct: 88, count: 1204 });
  });

  it('falls back to the theme name as its only preset, and nulls what is missing', () => {
    const f = parseThemeStorePage('<p>Nothing here</p>', 'Dawn');
    expect(f).toEqual({ presets: ['Dawn'], features: [], version: null, reviews: null });
  });
});

describe('crawler helpers', () => {
  it('cleans storefront site names', () => {
    expect(cleanSiteName('Everlane | Official Site')).toBe('Everlane');
    expect(cleanSiteName('Rancho Gordo – Online Store')).toBe('Rancho Gordo');
    expect(cleanSiteName('  Salt   & Stone ')).toBe('Salt & Stone');
    expect(cleanSiteName('X')).toBeNull();
    expect(cleanSiteName(null)).toBeNull();
  });
});

describe('provenance in meta.sources', () => {
  it('lists the Theme Store check from the seed', async () => {
    const db = seededDb();
    const info = await loadDataInfo(db);
    expect(info.sources['shopify-theme-store']?.url).toBe('https://themes.shopify.com');
    expect(info.sources['shopify-theme-store']?.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(info.sources['vitrine-crawl']).toBeUndefined();
    db.close();
  });

  it('adds our crawl once a scan is ingested, keeping the latest date', async () => {
    const db = seededDb();
    const base = {
      domain: 'thesill.com',
      url: 'https://www.thesill.com/',
      source: 'vitrine-crawl',
      rules_version: 'storepeek-signatures-v9',
      http_status: 200,
      platform: 'shopify' as const,
      site_name: 'The Sill',
      currency: 'USD',
      theme: null,
      apps: [],
      pixels: [],
    };
    await ingestScan(db, { ...base, scanned_at: '2026-11-26T10:00:00.000Z' });
    await ingestScan(db, { ...base, scanned_at: '2026-11-20T10:00:00.000Z' });
    const info = await loadDataInfo(db);
    expect(info.crawlLastAt).toBe('2026-11-26T10:00:00.000Z');
    expect(info.sources['vitrine-crawl']).toEqual({
      label: 'Our storefront crawl (storepeek-signatures-v9)',
      as_of: '2026-11-26',
      url: '/methodology',
    });
    db.close();
  });
});
