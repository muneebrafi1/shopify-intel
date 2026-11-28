/**
 * Additions for the sections library pages: the "mixed" browsing order (stable, keyset
 * paginated), distinct store/theme counts per type, and a section's place within its type.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { setup } from './helpers/db.ts';

const { db, api } = setup();
afterAll(() => db.close());

describe('sections library order', () => {
  it("'mixed' is stable, paginates without gaps and interleaves stores", async () => {
    const a = await api.listSections({ sort: 'mixed', limit: 20 });
    const again = await api.listSections({ sort: 'mixed', limit: 20 });
    expect(again.data.items.map((s) => s.id)).toEqual(a.data.items.map((s) => s.id));
    const b = await api.listSections({
      sort: 'mixed',
      limit: 20,
      cursor: a.meta.pagination?.next_cursor ?? '',
    });
    const ids = [...a.data.items, ...b.data.items].map((s) => s.id);
    expect(new Set(ids).size).toBe(40);
    expect(new Set(a.data.items.map((s) => s.store.domain)).size).toBeGreaterThan(5);
    // Cursors are tied to their order.
    await expect(
      api.listSections({ sort: 'id', cursor: a.meta.pagination?.next_cursor ?? '' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('walks every section of a type exactly once', async () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.listSections({ type: 'reviews', sort: 'mixed', limit: 10, cursor });
      seen.push(...page.data.items.map((s) => s.id));
      cursor = page.meta.pagination?.next_cursor ?? undefined;
    } while (cursor);
    const { meta } = await api.listSections({ type: 'reviews', limit: 1 });
    expect(seen).toHaveLength(meta.pagination?.total ?? -1);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('section type counts', () => {
  it('reports distinct stores and themes per type', async () => {
    const { data } = await api.listSectionTypes();
    const header = data.items.find((t) => t.slug === 'header');
    expect(header?.stores).toBeGreaterThan(1);
    expect(header?.stores).toBeLessThanOrEqual(header?.count ?? 0);
    expect(header?.themes).toBeGreaterThan(0);
    expect(header?.themes).toBeLessThanOrEqual(header?.stores ?? 0);
  });
});

describe('section position in its type', () => {
  it('links prev/next in library order and counts the position', async () => {
    const ids: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.listSections({ type: 'reviews', sort: 'mixed', limit: 60, cursor });
      ids.push(...page.data.items.map((s) => s.id));
      cursor = page.meta.pagination?.next_cursor ?? undefined;
    } while (cursor);
    const mid = ids[3]!;
    const { data } = await api.getSection({ id: mid });
    expect(data.in_type).toMatchObject({
      position: 4,
      total: ids.length,
      prev: { id: ids[2], href: `/sections/reviews/${ids[2]}` },
      next: { id: ids[4], href: `/sections/reviews/${ids[4]}` },
    });
    const first = await api.getSection({ id: ids[0]! });
    expect(first.data.in_type.prev).toBeNull();
    const last = await api.getSection({ id: ids[ids.length - 1]! });
    expect(last.data.in_type.next).toBeNull();
    expect(last.data.in_type.position).toBe(ids.length);
  });
});
