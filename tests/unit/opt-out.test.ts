import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isTombstoned, optOutStore } from '../../src/server/repo/opt-out.ts';
import { get, setup } from './helpers/db.ts';

const { db, api, http } = setup();
afterAll(() => db.close());

describe('opted-out stores disappear everywhere', () => {
  let before: { loox: number; prestige: number; reviews: number };

  beforeAll(async () => {
    before = {
      loox: (await api.getApp({ slug: 'loox' })).data.app.usage.stores,
      prestige: (await api.getTheme({ slug: 'prestige' })).data.theme.usage.stores,
      reviews: (await api.listSections({ type: 'reviews' })).meta.pagination?.total ?? 0,
    };
    const result = await optOutStore(db, 'www.youngla.com', { reason: 'test' });
    expect(result?.domain).toBe('youngla.com');
  });

  it('records a tombstone', async () => {
    expect(await isTombstoned(db, 'youngla.com')).toBe(true);
  });

  it('404s the store and its teardown', async () => {
    await expect(api.getStore({ domain: 'youngla.com' })).rejects.toMatchObject({ status: 404 });
    await expect(api.getTeardown({ slug: 'youngla' })).rejects.toMatchObject({ status: 404 });
    expect((await api.listTeardowns()).data.items).toEqual([]);
    expect((await get(http, '/api/v1/stores/youngla.com')).status).toBe(404);
  });

  it('removes it from lists, facets, counts and search', async () => {
    const stores = await api.listStores({ limit: 60, curated: true });
    expect(stores.data.items.map((s) => s.domain)).not.toContain('youngla.com');
    expect(stores.meta.pagination?.total).toBe(19);
    expect((await api.getMeta()).data.counts.stores_scanned).toBe(929);
    expect((await api.getApp({ slug: 'loox' })).data.app.usage.stores).toBe(before.loox - 1);
    const prestige = await api.getTheme({ slug: 'prestige' });
    expect(prestige.data.theme.usage.stores).toBe(before.prestige - 1);
    expect(prestige.data.curated_stores).toEqual([]);
    expect(prestige.data.stores.items.map((s) => s.store.domain)).not.toContain('youngla.com');
    const search = await api.search({ q: 'youngla' });
    expect(search.data.groups.flatMap((g) => g.items).map((i) => i.ref)).not.toContain(
      'youngla.com',
    );
    const appStores = await api.listAppStores({ slug: 'loox', limit: 100 });
    expect(appStores.data.items.map((s) => s.store.domain)).not.toContain('youngla.com');
  });

  it('removes its sections and screenshots from the library', async () => {
    const reviews = await api.listSections({ type: 'reviews', limit: 60 });
    expect(reviews.meta.pagination?.total).toBeLessThan(before.reviews);
    expect(reviews.data.items.map((s) => s.store.domain)).not.toContain('youngla.com');
    expect((await api.listSections({ store: 'youngla.com' })).meta.pagination?.total).toBe(0);
    const shot = await db.first<{ id: number }>(
      "SELECT sh.id FROM screenshots sh JOIN stores s ON s.id = sh.store_id WHERE s.domain = 'youngla.com' LIMIT 1",
    );
    await expect(api.getScreenshot({ id: shot?.id ?? 0 })).rejects.toMatchObject({ status: 404 });
    const loox = await api.getApp({ slug: 'loox' });
    expect(loox.data.seen_on.stores.map((s) => s.store.domain)).not.toContain('youngla.com');
    expect(loox.data.seen_on.sections.map((s) => s.store.domain)).not.toContain('youngla.com');
  });

  it('drops it from similar stores and comparisons', async () => {
    const other = await api.getStore({ domain: 'thursdayboots.com' });
    expect(other.data.similar.map((s) => s.store.domain)).not.toContain('youngla.com');
    const cmp = await api.getComparison({ pair: 'loox-vs-attentive' });
    expect(cmp.data.shared_stores.items.map((s) => s.domain)).not.toContain('youngla.com');
  });
});
