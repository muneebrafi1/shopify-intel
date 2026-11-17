import { afterAll, describe, expect, it } from 'vitest';
import { setup } from './helpers/db.ts';

const { db, api } = setup();
afterAll(() => db.close());

describe('compare', () => {
  it('renders curated pairs and canonicalises the order', async () => {
    const canonical = await api.getComparison({ pair: 'judgeme-vs-loox' });
    expect(canonical.data.is_canonical).toBe(true);
    expect(canonical.data.title).toBe('Judge.me vs Loox');
    expect(canonical.data.apps?.a.app.slug).toBe('judgeme');
    expect(canonical.data.apps?.b.app.slug).toBe('loox');
    expect(canonical.data.themes).toBeNull();

    const reversed = await api.getComparison({ pair: 'loox-vs-judgeme' });
    expect(reversed.data.is_canonical).toBe(false);
    expect(reversed.data.canonical_slug).toBe('judgeme-vs-loox');
    expect(reversed.meta.canonical).toBe('/compare/judgeme-vs-loox');
    // Same content either way: a is always the alphabetically first slug.
    expect(reversed.data.apps?.a.app.slug).toBe('judgeme');
  });

  it('builds a facts matrix with sources and objective winners only', async () => {
    const { data, meta } = await api.getComparison({ pair: 'judgeme-vs-loox' });
    const byKey = new Map(data.matrix.map((r) => [r.key, r]));
    expect(byKey.get('stores')).toMatchObject({ a: 221, b: 54, winner: 'a', better: 'higher' });
    expect(byKey.get('from_price')).toMatchObject({
      a: 1500,
      b: 4999,
      winner: 'a',
      better: 'lower',
    });
    expect(byKey.get('category')?.winner).toBeNull();
    for (const row of data.matrix) expect(meta.sources[row.source]).toBeDefined();
    expect(data.shared_stores.total).toBe(data.shared_stores.items.length);
  });

  it('compares themes, including apps popular on both', async () => {
    const { data } = await api.getComparison({ pair: 'horizon-vs-dawn' });
    expect(data.kind).toBe('theme');
    expect(data.canonical_slug).toBe('dawn-vs-horizon');
    expect(data.themes?.a.theme.usage.stores).toBe(20);
    expect(data.themes?.b.theme.usage.stores).toBe(14);
    expect(data.shared_apps.length).toBeGreaterThan(0);
  });

  it('rejects mixed, identical and unknown pairs', async () => {
    await expect(api.getComparison({ pair: 'klaviyo-vs-dawn' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(api.getComparison({ pair: 'loox-vs-loox' })).rejects.toMatchObject({
      status: 400,
    });
    // An alias and its canonical app are the same app.
    await expect(api.getComparison({ pair: 'boldupsell-vs-product-upsell' })).rejects.toMatchObject(
      { status: 400 },
    );
    await expect(api.getComparison({ pair: 'nope-vs-loox' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.getComparison({ pair: 'not a pair' })).rejects.toMatchObject({
      code: 'validation_error',
    });
  });

  it('404s valid pairs that are not curated (no thin long-tail pages)', async () => {
    // Different categories, and a same-category pair outside the top 3 (Bazaarvoice is 5th).
    for (const pair of ['judgeme-vs-klaviyo', 'bazaarvoice-vs-judgeme', 'judgeme-vs-bazaarvoice']) {
      await expect(api.getComparison({ pair })).rejects.toMatchObject({
        status: 404,
        details: [{ path: 'pair', message: 'not_curated' }],
      });
    }
    // Themes: Dawn and Bespoke are both real themes, but not a curated pair.
    await expect(api.getComparison({ pair: 'bespoke-vs-dawn' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('every curated pair renders, in either order', async () => {
    const { data } = await api.listComparisons({ limit: 200 });
    expect(data.items.length).toBeGreaterThan(20);
    for (const c of data.items) {
      const { data: cmp } = await api.getComparison({ pair: c.slug });
      expect(cmp.canonical_slug).toBe(c.slug);
    }
    const [a, b] = (data.items[0]?.slug ?? '').split('-vs-');
    const reversed = await api.getComparison({ pair: `${b}-vs-${a}` });
    expect(reversed.data.is_canonical).toBe(false);
  });

  it('lists popular comparisons: top apps per category and top theme pairs', async () => {
    const { data } = await api.listComparisons();
    const slugs = data.items.map((c) => c.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(['judgeme-vs-loox', 'dawn-vs-horizon', 'impact-vs-prestige']),
    );
    for (const c of data.items) {
      const [a, b] = c.slug.split('-vs-');
      expect((a ?? '') < (b ?? '')).toBe(true);
    }
    const forLoox = await api.listComparisons({ slug: 'loox' });
    expect(forLoox.data.items.every((c) => c.a.slug === 'loox' || c.b.slug === 'loox')).toBe(true);
  });
});

describe('alternatives', () => {
  it('lists same-category apps by usage with shared-store counts', async () => {
    const { data, meta } = await api.getAlternatives({ slug: 'klaviyo' });
    expect(data.kind).toBe('app');
    expect(data.title).toBe('Klaviyo alternatives');
    expect(meta.canonical).toBe('/alternatives/klaviyo');
    expect(data.items.length).toBeGreaterThan(3);
    expect(data.items.every((i) => i.app?.category?.slug === 'email-and-sms')).toBe(true);
    const usage = data.items.map((i) => i.app?.usage.stores ?? 0);
    expect([...usage].sort((a, b) => b - a)).toEqual(usage);
    expect(data.items[0]?.compare_href).toMatch(/^\/compare\/klaviyo-vs-|-vs-klaviyo$/);
    // Only curated pairs have a page: the flag says which compare links to show.
    const curated = new Set(
      (await api.listComparisons({ kind: 'app', limit: 200 })).data.items.map((c) => c.href),
    );
    for (const i of data.items) expect(i.compare_available).toBe(curated.has(i.compare_href));
    expect(data.items.some((i) => i.compare_available)).toBe(true);
    expect(data.items.some((i) => !i.compare_available)).toBe(true);
  });

  it('works for themes', async () => {
    const { data } = await api.getAlternatives({ slug: 'prestige' });
    expect(data.kind).toBe('theme');
    expect(data.items.map((i) => i.theme?.slug)).toEqual(
      expect.arrayContaining(['impact', 'stretch']),
    );
    // Impact vs Prestige is a curated pair (top themes).
    const impact = data.items.find((i) => i.theme?.slug === 'impact');
    expect(impact).toMatchObject({
      compare_href: '/compare/impact-vs-prestige',
      compare_available: true,
    });
  });

  it('has an index', async () => {
    const { data } = await api.listAlternatives();
    expect(data.apps[0]?.app.slug).toBe('klaviyo');
    expect(data.themes.find((t) => t.theme.slug === 'dawn')).toBeDefined();
  });
});
