import { afterAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/server/api/v1/errors.ts';
import { get, setup } from './helpers/db.ts';

const { db, api, http } = setup();
afterAll(() => db.close());

describe('meta', () => {
  it('reports provenance and counts', async () => {
    const { data, meta } = await api.getMeta();
    expect(data.data_as_of).toBe('2026-11-17');
    expect(data.counts.stores_scanned).toBe(930);
    expect(data.counts.stores_curated).toBe(20);
    expect(data.counts.stores_captured).toBe(0);
    expect(data.counts.screenshots_placeholder).toBe(160);
    expect(data.source.label).toContain('930 Shopify stores');
    expect(meta.api_version).toBe('v1');
    expect(meta.sources[data.source.id]?.as_of).toBe('2026-11-17');
  });
});

describe('stores', () => {
  it('defaults to the curated stores, with or without filters (owner decision)', async () => {
    const curated = await api.listStores({ limit: 60 });
    expect(curated.meta.pagination?.total).toBe(20);
    expect(curated.data.items.every((s) => s.is_curated)).toBe(true);
    expect(curated.data.facets.scope).toEqual({ curated: 20, all: 930 });
    // Filters keep the curated default; scope=all reaches every detected store.
    const dawn = await api.listStores({ theme: 'dawn' });
    expect(dawn.data.items.every((s) => s.is_curated)).toBe(true);
    expect(dawn.meta.pagination?.total).toBe(dawn.data.facets.scope.curated);
    expect(dawn.data.facets.scope.all).toBe(20);
    expect((await api.listStores({ theme: 'dawn', scope: 'all' })).meta.pagination?.total).toBe(20);
    // An explicit curated flag overrides the scope.
    const rest = await api.listStores({ curated: false });
    expect(rest.meta.pagination?.total).toBe(910);
    expect(rest.data.items.some((s) => s.is_curated)).toBe(false);
  });

  it('serves the curated default over HTTP too', async () => {
    const res = await get(http, '/api/v1/stores?theme=dawn');
    const body = (await res.json()) as { meta: { pagination: { total: number } } };
    const all = await get(http, '/api/v1/stores?theme=dawn&scope=all');
    const allBody = (await all.json()) as { meta: { pagination: { total: number } } };
    expect(body.meta.pagination.total).toBeLessThan(allBody.meta.pagination.total);
    expect(allBody.meta.pagination.total).toBe(20);
    expect((await get(http, '/api/v1/stores?scope=some')).status).toBe(400);
  });

  it('lists with facets and stable keyset pagination', async () => {
    const first = await api.listStores({ scope: 'all', limit: 24 });
    expect(first.meta.pagination?.total).toBe(930);
    expect(first.data.items[0]?.domain).toBe('youngla.com');
    expect(first.data.facets.curated).toBe(20);
    const seen = new Set(first.data.items.map((s) => s.domain));
    let cursor = first.meta.pagination?.next_cursor ?? null;
    for (let i = 0; i < 3 && cursor; i++) {
      const next = await api.listStores({ scope: 'all', limit: 24, cursor });
      for (const s of next.data.items) {
        expect(seen.has(s.domain)).toBe(false);
        seen.add(s.domain);
      }
      cursor = next.meta.pagination?.next_cursor ?? null;
    }
    expect(seen.size).toBe(96);
  });

  it('filters by theme and app with counts from the scan', async () => {
    const dawn = await api.listStores({ theme: 'dawn', scope: 'all', limit: 60 });
    expect(dawn.meta.pagination?.total).toBe(20);
    expect(dawn.data.items.every((s) => s.theme.theme?.slug === 'dawn')).toBe(true);
    const klaviyo = await api.listStores({ app: 'klaviyo', scope: 'all', sort: 'apps', limit: 10 });
    expect(klaviyo.meta.pagination?.total).toBe(383);
    const counts = klaviyo.data.items.map((s) => s.app_count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // A detected theme without a record is filterable by its slugified name.
    const foodie = await api.listStores({ theme: 'foodie', scope: 'all' });
    expect(foodie.meta.pagination?.total).toBe(5);
    // Facets ignore their own filter.
    expect(dawn.data.facets.themes.find((f) => f.value === 'horizon')?.count).toBe(14);
  });

  it('returns a rich store detail', async () => {
    const { data, meta } = await api.getStore({ domain: 'https://www.YoungLA.com/' });
    expect(meta.canonical).toBe('/stores/youngla.com');
    expect(data.store.name).toBe('YoungLA');
    expect(data.theme.current.label).toBe('Prestige 9.3.0');
    expect(data.apps.total).toBe(11);
    const loox = data.apps.groups.flatMap((g) => g.apps).find((a) => a.slug === 'loox');
    expect(loox?.seen_in.map((s) => s.slug)).toContain('reviews');
    expect(data.pixels).toEqual([{ slug: 'northbeam', name: 'Northbeam' }]);
    expect(data.pages.map((p) => p.page_type.slug)).toEqual([
      'home',
      'collection',
      'product',
      'cart',
    ]);
    const shot = data.pages[0]?.screenshots.desktop;
    expect(shot?.image.src).toBe(`/media/placeholder/shot/${shot?.id}.svg`);
    expect(shot?.is_placeholder).toBe(true);
    expect(shot?.sections[0]?.crop.src).toMatch(/^\/media\/placeholder\/section\/\d+\.svg$/);
    expect(data.devices).toEqual(['desktop', 'mobile']);
    expect(data.similar.length).toBeGreaterThan(0);
    expect(data.teardown?.href).toBe('/teardowns/youngla');
    expect(data.detection.rules_version).toBe('pre-v7');
  });

  it('counts unresolved apps without inventing profiles', async () => {
    const list = await api.listStores({ scope: 'all', sort: 'apps', limit: 1 });
    const top = list.data.items[0];
    if (!top) throw new Error('no store');
    const { data } = await api.getStore({ domain: top.domain });
    expect(data.apps.total).toBe(top.app_count);
    expect(data.apps.resolved + data.apps.unresolved.count).toBe(data.apps.total);
  });

  it('404s unknown stores with an ApiError', async () => {
    await expect(api.getStore({ domain: 'nope.example' })).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    await expect(api.getStore({ domain: 'nope.example' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('themes', () => {
  it('lists themes with usage, previews and price facets', async () => {
    const { data } = await api.listThemes();
    expect(data.items[0]?.slug).toBe('dawn');
    expect(data.items[0]?.usage.stores).toBe(20);
    expect(data.items[0]?.price).toEqual({ cents: 0, label: 'Free', is_free: true });
    const prestige = data.items.find((t) => t.slug === 'prestige');
    expect(prestige?.price.cents).toBe(40000);
    // One curated store: its desktop home capture, then its mobile one (cards pair devices).
    expect(prestige?.previews.map((p) => p.device)).toEqual(['desktop', 'mobile']);
    expect(data.facets.price_bands.find((b) => b.value === 'free')?.count).toBe(2);
    const free = await api.listThemes({ price: 'free' });
    expect(free.data.items.map((t) => t.slug).sort()).toEqual(['dawn', 'horizon']);
    const maestrooo = await api.listThemes({ vendor: 'maestrooo' });
    expect(maestrooo.meta.pagination?.total).toBe(3);
  });

  it('uses the affiliate redirect for the CTA when a link exists', async () => {
    // The seed has no theme affiliate link any more (Hyper's was dropped by
    // data/curation/overrides.json), so add one here to exercise the theme CTA path.
    await db.run(
      `INSERT INTO affiliate_links (target_type, target_id, target_name, program_id, url, label, active, created_at, updated_at)
       SELECT 'theme', id, name, NULL, 'https://example.com/ref', 'Affiliate link', 1, '2026-11-17', '2026-11-17'
       FROM themes WHERE slug = 'impulse'`,
    );
    const { data } = await api.getTheme({ slug: 'impulse' });
    expect(data.theme.cta?.is_affiliate).toBe(true);
    expect(data.theme.cta?.href).toMatch(/^\/go\/\d+$/);
    expect(data.theme.cta?.rel).toContain('sponsored');
    await db.run("DELETE FROM affiliate_links WHERE url = 'https://example.com/ref'");
    const hyper = await api.getTheme({ slug: 'hyper' });
    expect(hyper.data.theme.cta).toMatchObject({
      is_affiliate: false,
      href: 'https://themes.shopify.com/themes/hyper',
    });
    const dawn = await api.getTheme({ slug: 'dawn' });
    expect(dawn.data.theme.cta).toMatchObject({
      is_affiliate: false,
      href: 'https://themes.shopify.com/themes/dawn',
    });
  });

  it('returns a theme detail with stores, apps and sections', async () => {
    const { data } = await api.getTheme({ slug: 'prestige', stores_limit: 5 });
    expect(data.theme.usage.stores).toBe(13);
    expect(data.stores.total).toBe(13);
    expect(data.stores.items).toHaveLength(5);
    expect(data.stores.next_cursor).not.toBeNull();
    expect(data.curated_stores[0]?.store.domain).toBe('youngla.com');
    expect(data.curated_stores[0]?.pages).toHaveLength(4);
    expect(data.versions.find((v) => v.version === '9.3.0')?.stores).toBe(1);
    expect(data.top_apps[0]?.stores).toBeGreaterThan(0);
    expect(data.sections.items.length).toBeGreaterThan(0);
    expect(data.similar.map((s) => s.theme.slug)).toEqual(
      expect.arrayContaining(['impact', 'stretch']),
    );
    expect(data.presets).toEqual([]);
    const rest = await api.listThemeStores({
      slug: 'prestige',
      cursor: data.stores.next_cursor ?? '',
    });
    expect(rest.data.items).toHaveLength(8);
  });
});

describe('apps', () => {
  it('lists apps by usage with category facets', async () => {
    const { data, meta } = await api.listApps({ limit: 5 });
    expect(data.items[0]?.slug).toBe('klaviyo');
    expect(data.items[0]?.usage).toMatchObject({
      stores: 383,
      share: 0.4118,
      denominator: 930,
      rank: 1,
    });
    expect(meta.sources[data.items[0]?.usage.source ?? '']).toBeDefined();
    // 7 reviews apps: the export's 'trustpilot' record is a wrong match and is not created.
    expect(data.facets.categories.find((c) => c.value === 'reviews')?.count).toBe(7);
    const reviews = await api.listApps({ category: 'reviews', sort: 'rating' });
    expect(reviews.data.items.every((a) => a.category?.slug === 'reviews')).toBe(true);
    const bfs = await api.listApps({ built_for_shopify: true, min_rating: 4.9 });
    expect(bfs.data.items.every((a) => a.built_for_shopify && (a.rating ?? 0) >= 4.9)).toBe(true);
  });

  it('lists categories with surfaces and reach', async () => {
    const { data } = await api.listAppCategories();
    const reviews = data.items.find((c) => c.slug === 'reviews');
    expect(reviews?.surfaces.map((s) => s.slug)).toEqual(['reviews']);
    expect(reviews?.store_count).toBeGreaterThan(221);
    expect(reviews?.top_apps[0]?.slug).toBe('judgeme');
  });

  it('returns app detail with facts, usage, co-installs and alternatives', async () => {
    const { data } = await api.getApp({ slug: 'judgeme' });
    expect(data.app.usage.stores).toBe(221);
    expect(data.app.plans.length).toBeGreaterThan(0);
    expect(data.app.checked_on).toBe('2026-11-17');
    expect(data.app.facts_source).toBe('shopify-app-store');
    expect(data.app.short_name).toBe('Judge.me');
    expect(data.surfaces.map((s) => s.slug)).toEqual(['reviews']);
    expect(data.seen_on.sections.every((s) => s.app?.slug === 'judgeme')).toBe(true);
    expect(data.co_installed[0]?.app.slug).toBe('klaviyo');
    expect(data.alternatives.every((a) => a.category?.slug === 'reviews')).toBe(true);
    expect(data.comparisons.map((c) => c.slug)).toContain('judgeme-vs-loox');
    expect(data.stores.total).toBe(221);
    expect(data.themes.length).toBeGreaterThan(0);
  });

  it('resolves alias slugs to the canonical app', async () => {
    const { data, meta } = await api.getApp({ slug: 'boldupsell' });
    expect(data.app.slug).toBe('product-upsell');
    expect(meta.canonical).toBe('/apps/product-upsell');
    expect(data.app.aliases).toEqual(['boldupsell']);
  });

  it('marks affiliate CTAs and never leaks referral URLs', async () => {
    const { data } = await api.getApp({ slug: 'helpdesk' });
    expect(data.app.cta).toMatchObject({
      is_affiliate: true,
      label: 'View on the Shopify App Store',
    });
    expect(JSON.stringify(data)).not.toContain('partner.gorgias.com');
  });
});
