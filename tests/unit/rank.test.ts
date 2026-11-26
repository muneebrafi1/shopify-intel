import { afterAll, describe, expect, it } from 'vitest';
import { updateApp } from '../../src/server/admin/actions.ts';
import { competitionRank, competitionRanks } from '../../src/lib/rank.ts';
import { FIXED_NOW, setup } from './helpers/db.ts';

describe('competitionRanks', () => {
  it('gives equal values the same rank and skips the next one', () => {
    expect(competitionRanks([10, 8, 8, 5])).toEqual([1, 2, 2, 4]);
    expect(competitionRanks([20, 14, 8, 8, 8, 7])).toEqual([1, 2, 3, 3, 3, 6]);
    expect(competitionRank(7, [20, 14, 8, 8, 8, 7])).toBe(6);
  });

  it('does not depend on the input order', () => {
    expect(competitionRanks([5, 8, 10, 8])).toEqual([4, 2, 1, 2]);
    expect(competitionRanks([3, 3, 3])).toEqual([1, 1, 1]);
    expect(competitionRanks([])).toEqual([]);
  });
});

describe('usage ranks in the API', () => {
  const { db, api } = setup();
  afterAll(() => db.close());

  it('ties share a theme rank, the next rank skips, and ties list by name', async () => {
    const { data } = await api.listThemes({ sort: 'usage', limit: 100 });
    const at = (slug: string) => data.items.find((t) => t.slug === slug)?.usage;
    // Hyper, Impact and Impulse are each detected on 8 stores; Flow and Symmetry on 7.
    expect([at('hyper'), at('impact'), at('impulse')].map((u) => u?.stores)).toEqual([8, 8, 8]);
    const above = (n: number) => data.items.filter((t) => t.usage.stores > n).length;
    const rank8 = 1 + above(8);
    expect(at('hyper')?.rank).toBe(rank8);
    expect(at('impact')?.rank).toBe(rank8);
    expect(at('impulse')?.rank).toBe(rank8);
    // The next rank skips past the three-way tie.
    expect(at('flow')?.rank).toBe(rank8 + 3);
    expect(at('symmetry')?.rank).toBe(rank8 + 3);
    const order = data.items.map((t) => t.slug);
    expect(order.indexOf('hyper')).toBeLessThan(order.indexOf('impact'));
    expect(order.indexOf('impact')).toBeLessThan(order.indexOf('impulse'));
    // Every rank equals 1 + the number of themes with strictly more stores.
    const counts = data.items.map((t) => t.usage.stores);
    expect(data.items.map((t) => t.usage.rank)).toEqual(competitionRanks(counts));
    // getTheme reports the same rank as the list.
    expect((await api.getTheme({ slug: 'impulse' })).data.theme.usage.rank).toBe(rank8);
  });

  it('ranks apps overall and within their category with competition ranking', async () => {
    const all = await api.listApps({ sort: 'usage', limit: 100 });
    const page2 = await api.listApps({
      sort: 'usage',
      limit: 100,
      ...(all.meta.pagination?.next_cursor ? { cursor: all.meta.pagination.next_cursor } : {}),
    });
    const items = [
      ...all.data.items,
      ...(all.meta.pagination?.next_cursor ? page2.data.items : []),
    ].filter((a) => a.usage.stores > 0);
    expect(items.map((a) => a.usage.rank)).toEqual(
      competitionRanks(items.map((a) => a.usage.stores)),
    );
    const byCategory = new Map<string, typeof items>();
    for (const a of items) {
      const key = a.category?.slug ?? '';
      byCategory.set(key, [...(byCategory.get(key) ?? []), a]);
    }
    let ties = 0;
    for (const list of byCategory.values()) {
      const counts = list.map((a) => a.usage.stores);
      expect(list.map((a) => a.category_rank)).toEqual(competitionRanks(counts));
      ties += counts.length - new Set(counts).size;
    }
    expect(ties).toBeGreaterThan(0); // the seed has real ties, so this exercises them
    // Tied apps are listed by name, case-insensitively (SQLite NOCASE folds ASCII only).
    const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
    for (let i = 1; i < items.length; i++) {
      const [a, b] = [items[i - 1]!, items[i]!];
      if (a.usage.stores === b.usage.stores) expect(fold(a.name) <= fold(b.name)).toBe(true);
    }
  });

  it('hidden apps take no rank, so nothing public has a gap', async () => {
    const before = await api.listApps({ sort: 'usage', limit: 3 });
    const [first, second] = before.data.items;
    expect(first?.usage.rank).toBe(1);
    const row = await db.first<{ id: number }>('SELECT id FROM apps WHERE slug = ?', [
      first?.slug ?? '',
    ]);
    const res = await updateApp({ db, actor: 'test', now: FIXED_NOW }, row?.id ?? 0, {
      status: 'hidden',
    });
    expect(res.ok).toBe(true);
    const after = await api.listApps({ sort: 'usage', limit: 3 });
    expect(after.data.items[0]?.slug).toBe(second?.slug);
    expect(after.data.items[0]?.usage.rank).toBe(1);
  });
});
