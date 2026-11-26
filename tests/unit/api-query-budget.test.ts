/**
 * D1 allows 50 queries per Worker invocation on the free plan, so list pages batch their reads:
 * `listSectionsByApps` (one query for many apps), `facets: false` on the list endpoints, the
 * slug/domain lookups, and the batched app/theme details behind getComparison. These tests pin
 * both the results (same as the one-at-a-time calls they replace) and the query counts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, SqlValue, Statement } from '../../src/server/db/types.ts';
import { buildCtx, createRuntime } from '../../src/server/api/v1/execute.ts';
import { appDetails, findApps, getAppDetail } from '../../src/server/repo/apps.ts';
import { findThemes, getThemeDetail, themeDetails } from '../../src/server/repo/themes.ts';
import { get, setup, testDeps } from './helpers/db.ts';

const { db, http } = setup();
afterAll(() => db.close());

/** The seeded db with a statement counter (what the dev-only x-d1-queries header reports). */
const counter = { n: 0 };
const counted: Db = {
  all: <Row>(sql: string, params?: readonly SqlValue[]) => {
    counter.n += 1;
    return db.all<Row>(sql, params);
  },
  first: <Row>(sql: string, params?: readonly SqlValue[]) => {
    counter.n += 1;
    return db.first<Row>(sql, params);
  },
  run: (sql: string, params?: readonly SqlValue[]) => {
    counter.n += 1;
    return db.run(sql, params);
  },
  batch: (statements: readonly Statement[]) => {
    counter.n += statements.length;
    return db.batch(statements);
  },
};
const { api } = setup({ db: counted });
const queries = async <T>(call: () => Promise<T>): Promise<[T, number]> => {
  counter.n = 0;
  const result = await call();
  return [result, counter.n];
};

let apps: string[] = [];
beforeAll(async () => {
  await api.getMeta(); // the runtime reads the data meta once; keep it out of the counts
  // Every app with sections, plus a slice of the ones without (the empty path is the same for all).
  apps = (
    await db.all<{ slug: string }>(
      `SELECT slug FROM (
         SELECT a.slug, a.id, EXISTS (SELECT 1 FROM sections s WHERE s.app_id = a.id) AS has
         FROM apps a WHERE a.status = 'active')
       WHERE has = 1 OR id IN (SELECT id FROM apps WHERE status = 'active' ORDER BY id LIMIT 40)
       ORDER BY id`,
    )
  ).map((r) => r.slug);
});

describe('listSectionsByApps', () => {
  it('matches listSections per app (items, order, total) in one query', async () => {
    for (const sort of ['id', 'mixed'] as const) {
      for (const device of [undefined, 'desktop', 'mobile'] as const) {
        for (let i = 0; i < apps.length; i += 50) {
          const chunk = apps.slice(i, i + 50);
          const [batch, n] = await queries(() =>
            api.listSectionsByApps({ apps: chunk, device, sort, per_app: 4 }),
          );
          expect(n).toBe(1);
          expect(batch.data.items.map((x) => x.app_slug)).toEqual(chunk);
          for (const item of batch.data.items) {
            const one = await api.listSections({ app: item.app_slug, device, sort, limit: 4 });
            expect(item.sections, `${item.app_slug} ${sort} ${device}`).toEqual(one.data.items);
            expect(item.total).toBe(one.meta.pagination?.total);
          }
        }
      }
    }
  });

  it('keeps tie order: the mixed order equals the library order of each app', async () => {
    const { data } = await api.listSectionsByApps({
      apps: ['judgeme'],
      sort: 'mixed',
      per_app: 24,
    });
    const one = await api.listSections({ app: 'judgeme', sort: 'mixed', limit: 24 });
    expect(data.items[0]?.sections.map((s) => s.id)).toEqual(one.data.items.map((s) => s.id));
    expect(data.items[0]?.sections.length).toBeGreaterThan(4);
  });

  it('cuts each app at per_app without changing its total', async () => {
    const { data } = await api.listSectionsByApps({ apps: ['judgeme', 'loox'], per_app: 2 });
    for (const item of data.items) {
      expect(item.sections).toHaveLength(2);
      expect(item.total).toBeGreaterThan(2);
      const first = await api.listSections({ app: item.app_slug, limit: 2 });
      expect(item.sections).toEqual(first.data.items);
    }
  });

  it('applies the section filters like listSections', async () => {
    const filters = { type: 'reviews', page_type: 'product', device: 'desktop' } as const;
    const { data } = await api.listSectionsByApps({ apps: ['loox', 'judgeme'], ...filters });
    for (const item of data.items) {
      const one = await api.listSections({ app: item.app_slug, ...filters, limit: 6 });
      expect(item.sections).toEqual(one.data.items);
      expect(item.total).toBe(one.meta.pagination?.total);
      expect(item.sections.every((s) => s.type.slug === 'reviews')).toBe(true);
    }
  });

  it('ignores unknown slugs, keeps request order, resolves aliases, dedupes', async () => {
    const { data } = await api.listSectionsByApps({
      apps: ['nope', 'loox', 'boldupsell', 'judgeme', 'loox'],
    });
    expect(data.items.map((x) => x.app_slug)).toEqual(['loox', 'boldupsell', 'judgeme']);
    const viaAlias = data.items[1]!;
    const canonical = await api.listSections({ app: 'product-upsell', limit: 6 });
    expect(viaAlias.sections).toEqual(canonical.data.items);
    expect(viaAlias.sections.every((s) => s.app?.slug === 'product-upsell')).toBe(true);
  });

  it('returns known apps without a matching section with total 0', async () => {
    const quiet = await db.first<{ slug: string }>(
      `SELECT a.slug FROM apps a WHERE a.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM sections s WHERE s.app_id = a.id) LIMIT 1`,
    );
    expect(quiet).not.toBeNull();
    const { data } = await api.listSectionsByApps({ apps: [quiet!.slug, 'zzz-unknown'] });
    expect(data.items).toEqual([{ app_slug: quiet!.slug, total: 0, sections: [] }]);
  });

  it('takes a comma-separated list over HTTP', async () => {
    const res = await get(
      http,
      '/api/v1/sections-by-app?apps=loox,judgeme&per_app=2&device=mobile',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: Array<{ app_slug: string; total: number; sections: unknown[] }> };
    };
    expect(body.data.items.map((x) => x.app_slug)).toEqual(['loox', 'judgeme']);
    const viaClient = await api.listSectionsByApps({
      apps: ['loox', 'judgeme'],
      per_app: 2,
      device: 'mobile',
    });
    expect(body.data).toEqual(JSON.parse(JSON.stringify(viaClient.data)));
  });

  it('validates its input (1 to 50 apps, per_app 1 to 24)', async () => {
    await expect(api.listSectionsByApps({ apps: [] })).rejects.toMatchObject({ status: 400 });
    const many = Array.from({ length: 51 }, (_, i) => `app-${i}`);
    await expect(api.listSectionsByApps({ apps: many })).rejects.toMatchObject({ status: 400 });
    await expect(api.listSectionsByApps({ apps: ['loox'], per_app: 25 })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('facets: false', () => {
  it('listSections returns the same items and total without facets or type info', async () => {
    const input = { type: 'header', page_type: 'home', limit: 40 } as const;
    const [full, fullN] = await queries(() => api.listSections(input));
    const [lean, leanN] = await queries(() => api.listSections({ ...input, facets: false }));
    expect(lean.data.items).toEqual(full.data.items);
    expect(lean.meta.pagination).toEqual(full.meta.pagination);
    expect(lean.data.section_type).toBeNull();
    expect(Object.values(lean.data.facets).every((f) => f.length === 0)).toBe(true);
    expect(leanN).toBe(2);
    expect(fullN).toBeGreaterThan(leanN);
  });

  it('listStores, listApps and listThemes skip their facet queries', async () => {
    const [stores, storesN] = await queries(() =>
      api.listStores({ scope: 'all', limit: 10, facets: false }),
    );
    const full = await api.listStores({ scope: 'all', limit: 10 });
    expect(stores.data.items).toEqual(full.data.items);
    expect(stores.data.facets).toMatchObject({ themes: [], apps: [], curated: 0 });
    expect(storesN).toBe(4); // rows, total, top apps, previews

    const [appsList, appsN] = await queries(() => api.listApps({ limit: 10, facets: false }));
    expect(appsList.data.items).toEqual((await api.listApps({ limit: 10 })).data.items);
    expect(appsList.data.facets.categories).toEqual([]);
    expect(appsN).toBe(3);

    const [themes, themesN] = await queries(() => api.listThemes({ limit: 10, facets: false }));
    expect(themes.data.items).toEqual((await api.listThemes({ limit: 10 })).data.items);
    expect(themes.data.facets).toEqual({ vendors: [], price_bands: [] });
    expect(themesN).toBe(4);
  });
});

describe('lookups by key', () => {
  it('listStores({ domains }) returns exactly those stores', async () => {
    const all = await api.listStores({ scope: 'all', limit: 60 });
    const pick = [all.data.items[3]!, all.data.items[40]!, all.data.items[7]!];
    const { data, meta } = await api.listStores({
      domains: [...pick.map((s) => s.domain), 'not-a-store.example'],
      scope: 'all',
      facets: false,
    });
    expect(meta.pagination?.total).toBe(3);
    // List order (rank), not request order; each item is the same list item as before.
    expect(data.items).toEqual([pick[0], pick[2], pick[1]]);
    const upper = await api.listStores({
      domains: [`https://WWW.${pick[0]!.domain}/`],
      scope: 'all',
    });
    expect(upper.data.items.map((s) => s.domain)).toEqual([pick[0]!.domain]);
  });

  it('listApps({ slugs }) and listThemes({ slugs }) return exactly those', async () => {
    const appsList = await api.listApps({ slugs: ['loox', 'judgeme', 'boldupsell', 'nope'] });
    expect(appsList.data.items.map((a) => a.slug).sort()).toEqual([
      'judgeme',
      'loox',
      'product-upsell',
    ]);
    const all = new Map((await api.listApps({ limit: 100 })).data.items.map((a) => [a.slug, a]));
    for (const a of appsList.data.items) expect(a).toEqual(all.get(a.slug));

    const themes = await api.listThemes({ slugs: ['dawn', 'prestige', 'nope'] });
    expect(themes.data.items.map((t) => t.slug).sort()).toEqual(['dawn', 'prestige']);
    expect(themes.meta.pagination?.total).toBe(2);
  });
});

describe('batched details', () => {
  const opts = { storesLimit: 12, sectionsLimit: 8 };

  it('appDetails for several apps equals getAppDetail for each', async () => {
    const ctx = await buildCtx(createRuntime(testDeps(db)), null);
    const rows = await findApps(ctx, apps);
    for (let i = 0; i + 1 < apps.length; i += 2) {
      const pair = [rows.get(apps[i]!)!, rows.get(apps[i + 1]!)!];
      const both = await appDetails(ctx, pair, opts);
      expect(both[0]).toEqual(await getAppDetail(ctx, apps[i]!, opts));
      expect(both[1]).toEqual(await getAppDetail(ctx, apps[i + 1]!, opts));
    }
  });

  it('themeDetails for several themes equals getThemeDetail for each', async () => {
    const ctx = await buildCtx(createRuntime(testDeps(db)), null);
    const slugs = (
      await db.all<{ slug: string }>("SELECT slug FROM themes WHERE status = 'active'")
    ).map((r) => r.slug);
    const rows = await findThemes(ctx, slugs);
    const all = await themeDetails(
      ctx,
      slugs.map((s) => rows.get(s)!),
      { storesLimit: 3 },
    );
    for (const [i, slug] of slugs.entries()) {
      expect(all[i]).toEqual(await getThemeDetail(ctx, slug, { storesLimit: 3 }));
    }
  });

  it('keeps details and comparisons within the per-request query budget', async () => {
    const budget: Array<[string, () => Promise<unknown>, number]> = [
      ['getApp', () => api.getApp({ slug: 'judgeme' }), 11],
      ['getTheme', () => api.getTheme({ slug: 'dawn' }), 14],
      ['getComparison (apps)', () => api.getComparison({ pair: 'judgeme-vs-loox' }), 16],
      ['getComparison (themes)', () => api.getComparison({ pair: 'dawn-vs-horizon' }), 19],
    ];
    for (const [label, call, max] of budget) {
      const [, n] = await queries(call);
      expect(n, label).toBeLessThanOrEqual(max);
    }
  });
});
