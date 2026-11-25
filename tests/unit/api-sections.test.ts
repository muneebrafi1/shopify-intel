import { afterAll, describe, expect, it } from 'vitest';
import { seedResult, setup } from './helpers/db.ts';

const { db, api } = setup();
const SECTION_TOTAL = seedResult().report.counts.sections ?? -1;
afterAll(() => db.close());

describe('sections library', () => {
  it('filters by type and reports facets per filter', async () => {
    const { data, meta } = await api.listSections({ type: 'reviews', limit: 60 });
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.every((s) => s.type.slug === 'reviews')).toBe(true);
    expect(data.section_type?.slug).toBe('reviews');
    expect(data.section_type?.app_categories).toContain('Reviews');
    // Type facets ignore the type filter; device facets respect it.
    const devices = data.facets.devices.reduce((sum, f) => sum + f.count, 0);
    expect(devices).toBe(meta.pagination?.total);
    expect(data.facets.types.length).toBeGreaterThan(10);
    // Every product-page reviews section is rendered by a detected reviews app.
    const product = data.items.filter((s) => s.page_type === 'product');
    expect(product.every((s) => s.app?.category?.slug === 'reviews')).toBe(true);
  });

  it('sums type facets to the total when unfiltered', async () => {
    const { data, meta } = await api.listSections({ limit: 1 });
    const sum = data.facets.types.reduce((s, f) => s + f.count, 0);
    expect(sum).toBe(meta.pagination?.total);
    expect(meta.pagination?.total).toBe(SECTION_TOTAL);
  });

  it('combines device, theme, app and store filters', async () => {
    const mobile = await api.listSections({ device: 'mobile', page_type: 'product', limit: 60 });
    expect(mobile.data.items.every((s) => s.device === 'mobile' && s.page_type === 'product')).toBe(
      true,
    );
    const prestige = await api.listSections({ theme: 'prestige', limit: 60 });
    expect(prestige.data.items.every((s) => s.theme?.slug === 'prestige')).toBe(true);
    const loox = await api.listSections({ app: 'loox', limit: 60 });
    expect(loox.data.items.length).toBeGreaterThan(0);
    expect(loox.data.items.every((s) => s.app?.slug === 'loox')).toBe(true);
    const store = await api.listSections({ store: 'youngla.com', group: 'navigation', limit: 60 });
    expect(
      store.data.items.every(
        (s) => s.store.domain === 'youngla.com' && s.type.group.slug === 'navigation',
      ),
    ).toBe(true);
    const unknown = await api.listSections({ theme: 'no-such-theme' });
    expect(unknown.meta.pagination?.total).toBe(0);
  });

  it('paginates with a cursor', async () => {
    const a = await api.listSections({ type: 'footer', limit: 10 });
    const b = await api.listSections({
      type: 'footer',
      limit: 10,
      cursor: a.meta.pagination?.next_cursor ?? '',
    });
    const ids = new Set([...a.data.items, ...b.data.items].map((s) => s.id));
    expect(ids.size).toBe(20);
    await expect(api.listSections({ cursor: 'garbage' })).rejects.toMatchObject({ status: 400 });
  });

  it('describes crops and screenshots with sizes for layout', async () => {
    const { data } = await api.listSections({ type: 'buy-box', device: 'desktop', limit: 1 });
    const card = data.items[0];
    expect(card?.rect.w).toBeLessThan(1440);
    expect(card?.crop).toMatchObject({
      width: card?.rect.w,
      height: card?.rect.h,
      is_placeholder: true,
    });
    expect(card?.hints?.column).toBe('right');
    expect(card?.screenshot.image.src).toBe(`/media/placeholder/shot/${card?.screenshot.id}.svg`);
  });

  it('lists section types with counts and previews', async () => {
    const { data } = await api.listSectionTypes();
    expect(data.items).toHaveLength(31);
    expect(data.items.find((t) => t.slug === 'header')?.count).toBe(400);
    expect(data.groups.reduce((s, g) => s + g.count, 0)).toBe(SECTION_TOTAL);
    expect(data.items.find((t) => t.slug === 'hero')?.preview?.type.slug).toBe('hero');
  });

  it('returns section and screenshot detail', async () => {
    const list = await api.listSections({ type: 'reviews', page_type: 'product', limit: 1 });
    const id = list.data.items[0]?.id ?? 0;
    const { data } = await api.getSection({ id });
    expect(data.section.id).toBe(id);
    expect(data.screenshot.sections.map((s) => s.id)).toContain(id);
    expect(
      data.more_like_this.every(
        (s) => s.type.slug === 'reviews' && s.store.domain !== data.section.store.domain,
      ),
    ).toBe(true);
    const shot = await api.getScreenshot({ id: data.screenshot.id });
    expect(shot.data.height).toBe(Math.max(...shot.data.sections.map((s) => s.rect.y + s.rect.h)));
    await expect(api.getScreenshot({ id: 999999 })).rejects.toMatchObject({ status: 404 });
  });
});

describe('teardowns', () => {
  it('lists and resolves notes to sections', async () => {
    const list = await api.listTeardowns();
    expect(list.data.items.map((t) => t.slug).sort()).toEqual(['fishwife', 'thesill', 'youngla']);
    expect(list.data.items.every((t) => t.is_sample)).toBe(true);
    expect(list.data.items.find((t) => t.slug === 'youngla')).toMatchObject({
      is_sample: true,
      note_count: 5,
    });
    const { data } = await api.getTeardown({ slug: 'youngla' });
    expect(data.store.store.domain).toBe('youngla.com');
    expect(data.notes.map((n) => n.n)).toEqual([1, 2, 3, 4, 5]);
    for (const note of data.notes) {
      expect(note.section?.type.slug).toBe(note.section_type.slug);
    }
    expect(data.notes.find((n) => n.section_type.slug === 'reviews')?.section?.app?.slug).toBe(
      'loox',
    );
  });
});
