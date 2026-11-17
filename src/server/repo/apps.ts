/** App queries: catalogue list, categories, detail, stores running an app. */
import { APP_CATEGORY_SURFACES } from '../../lib/taxonomy.ts';
import { SOURCE_IDS, type Ctx } from '../api/v1/context.ts';
import { notFound } from '../api/v1/errors.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import {
  decodeCursor,
  decodeOffset,
  encodeCursor,
  nextOffsetCursor,
} from '../api/v1/pagination.ts';
import type {
  AppCategory,
  AppDetail,
  AppFacts,
  AppListItem,
  AppPlan,
  AppStoreRow,
} from '../api/v1/schemas/apps.ts';
import type { Facet, SectionCard } from '../api/v1/schemas/common.ts';
import type { SqlValue } from '../db/types.ts';
import { activeLinks, buildCta } from './affiliate.ts';
import { comparisonLinks } from './comparisons.ts';
import { ftsPrefixQuery } from './fts.ts';
import {
  APP_REF_COLS,
  STORE_THEME_COLS,
  appPricing,
  appRef,
  bool,
  boolOrNull,
  categorySurfaces,
  groupBy,
  jsonIds,
  parseStringArray,
  ratio,
  storeRef,
  storeThemeInfo,
  themeRef,
  usageStat,
  type AppRefRow,
  type StoreThemeRow,
} from './refs.ts';
import { groupedSectionCards, homePreviews } from './visual.ts';

const APP_COLS = `a.id, ${APP_REF_COLS}, a.developer, a.tagline, a.rating, a.reviews,
  a.free_plan, a.from_price_cents, a.trial_days, a.built_for_shopify, a.profile,
  a.app_store_url, a.website_url, a.category_id,
  COALESCE(st.store_count, 0) AS store_count, st.denominator, st.rank_overall,
  st.rank_in_category, COALESCE(st.section_count, 0) AS section_count`;
const APP_FROM = `FROM apps a
LEFT JOIN app_categories ac ON ac.id = a.category_id
LEFT JOIN app_stats st ON st.app_id = a.id`;
export const APP_SELECT = `SELECT ${APP_COLS} ${APP_FROM}`;

export interface AppRow extends AppRefRow {
  id: number;
  developer: string | null;
  tagline: string | null;
  rating: number | null;
  reviews: number | null;
  free_plan: number | null;
  from_price_cents: number | null;
  trial_days: number | null;
  built_for_shopify: number | null;
  profile: 'full' | 'basic';
  app_store_url: string | null;
  website_url: string | null;
  category_id: number | null;
  store_count: number;
  denominator: number | null;
  rank_overall: number | null;
  rank_in_category: number | null;
  section_count: number;
}

export async function hydrateApps(ctx: Ctx, rows: AppRow[]): Promise<AppListItem[]> {
  const links = await activeLinks(
    ctx,
    'app',
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...appRef(r),
    developer: r.developer,
    tagline: r.tagline,
    rating: r.rating,
    reviews: r.reviews,
    pricing: appPricing(r),
    built_for_shopify: boolOrNull(r.built_for_shopify),
    profile: r.profile,
    usage: usageStat(ctx, r.store_count, r.denominator, r.rank_overall),
    category_rank: r.store_count > 0 && r.category_id !== null ? r.rank_in_category : null,
    cta: buildCta({
      linkId: links.get(r.id),
      officialUrl: r.app_store_url ?? r.website_url,
      label: r.app_store_url ? 'View on the Shopify App Store' : 'Visit website',
    }),
  }));
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------
export interface ListAppsParams {
  category?: string | undefined;
  price?: 'free' | 'paid' | undefined;
  built_for_shopify?: boolean | undefined;
  min_rating?: number | undefined;
  profile?: 'full' | 'basic' | undefined;
  q?: string | undefined;
  /** Only these apps (slugs or aliases). */
  slugs?: readonly string[] | undefined;
  sort: 'usage' | 'rating' | 'reviews' | 'name';
  cursor?: string | undefined;
  limit: number;
  /** false: skip the category facet (returned empty). */
  facets?: boolean | undefined;
}

function appWhere(p: ListAppsParams, omitCategory = false) {
  const where = ["a.status = 'active'"];
  const params: SqlValue[] = [];
  if (p.slugs) {
    where.push(
      `(a.slug IN (SELECT value FROM json_each(?))
        OR a.id IN (SELECT app_id FROM app_aliases WHERE slug IN (SELECT value FROM json_each(?))))`,
    );
    params.push(jsonIds(p.slugs), jsonIds(p.slugs));
  }
  if (p.category && !omitCategory) {
    where.push('ac.slug = ?');
    params.push(p.category);
  }
  if (p.price === 'free') where.push('a.free_plan = 1');
  if (p.price === 'paid') where.push('a.free_plan = 0');
  if (p.built_for_shopify !== undefined)
    where.push(`a.built_for_shopify = ${p.built_for_shopify ? 1 : 0}`);
  if (p.min_rating !== undefined) {
    where.push('a.rating >= ?');
    params.push(p.min_rating);
  }
  if (p.profile) {
    where.push('a.profile = ?');
    params.push(p.profile);
  }
  if (p.q?.trim()) {
    const fts = ftsPrefixQuery(p.q);
    if (!fts) where.push('0');
    else {
      where.push(
        "a.slug IN (SELECT ref FROM search_index WHERE search_index MATCH ? AND kind = 'app')",
      );
      params.push(fts);
    }
  }
  return { sql: where.join(' AND '), params };
}

// Ties in usage share a rank (app_stats); their display order is the name, then the slug.
const APP_ORDER = {
  usage: 'store_count DESC, a.name COLLATE NOCASE, a.slug',
  rating: 'a.rating IS NULL, a.rating DESC, a.reviews DESC, a.name',
  reviews: 'a.reviews IS NULL, a.reviews DESC, a.name',
  name: 'a.name',
} as const;

export async function listApps(ctx: Ctx, p: ListAppsParams) {
  const offset = decodeOffset(p.cursor);
  const w = appWhere(p);
  const cw = appWhere(p, true);
  const [rows, total, categories] = await Promise.all([
    ctx.db.all<AppRow>(
      `${APP_SELECT} WHERE ${w.sql} ORDER BY ${APP_ORDER[p.sort]} LIMIT ? OFFSET ?`,
      [...w.params, p.limit, offset],
    ),
    ctx.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM apps a LEFT JOIN app_categories ac ON ac.id = a.category_id WHERE ${w.sql}`,
      w.params,
    ),
    p.facets === false
      ? Promise.resolve([])
      : ctx.db.all<Facet>(
          `SELECT ac.slug AS value, ac.name AS label, COUNT(*) AS count
           FROM apps a JOIN app_categories ac ON ac.id = a.category_id
           WHERE ${cw.sql} GROUP BY ac.id ORDER BY count DESC, label`,
          cw.params,
        ),
  ]);
  const n = total?.n ?? 0;
  return {
    items: await hydrateApps(ctx, rows),
    facets: { categories },
    pagination: { limit: p.limit, next_cursor: nextOffsetCursor(offset, p.limit, n), total: n },
  };
}

// ---------------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------------
export async function listAppCategories(ctx: Ctx): Promise<AppCategory[]> {
  const [cats, reach, top] = await Promise.all([
    ctx.db.all<{ id: number; slug: string; name: string; app_count: number }>(
      `SELECT ac.id, ac.slug, ac.name, COUNT(a.id) AS app_count
       FROM app_categories ac LEFT JOIN apps a ON a.category_id = ac.id AND a.status = 'active'
       GROUP BY ac.id HAVING app_count > 0 ORDER BY ac.position`,
    ),
    // Distinct stores per category. A full pass over open detections; cached at the edge.
    ctx.db.all<{ category_id: number; n: number }>(
      `SELECT a.category_id, COUNT(DISTINCT sa.store_id) AS n
       FROM store_apps sa
       JOIN apps a ON a.id = sa.app_id AND a.status = 'active'
       JOIN stores s ON s.id = sa.store_id AND s.status = 'active'
       WHERE sa.removed_at IS NULL GROUP BY a.category_id`,
    ),
    ctx.db.all<AppRefRow & { category_id: number }>(
      `SELECT category_id, app_slug, app_name, app_short_name, app_icon_url, app_cat_slug, app_cat_name
       FROM (
         SELECT a.category_id, ${APP_REF_COLS},
           ROW_NUMBER() OVER (PARTITION BY a.category_id ORDER BY st.store_count DESC, a.slug) AS rn
         FROM apps a
         LEFT JOIN app_categories ac ON ac.id = a.category_id
         LEFT JOIN app_stats st ON st.app_id = a.id
         WHERE a.status = 'active'
       ) WHERE rn <= 3`,
    ),
  ]);
  const denominator = await ctx.db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM stores WHERE status = 'active'",
  );
  return cats.map((c) => {
    const stores = reach.find((r) => r.category_id === c.id)?.n ?? 0;
    return {
      slug: c.slug,
      name: c.name,
      href: hrefs.appCategory(c.slug),
      app_count: c.app_count,
      store_count: stores,
      share: ratio(stores, denominator?.n ?? 0),
      surfaces: categorySurfaces(c.name),
      top_apps: top.filter((t) => t.category_id === c.id).map((t) => appRef(t)),
      source: ctx.data.scanSourceId,
      as_of: ctx.data.dataAsOf,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------
export interface AppFactsRow extends AppRow {
  app_store_handle: string | null;
  app_store_category: string | null;
  launched_on: string | null;
  plans_json: string | null;
  features_json: string | null;
  works_with_json: string | null;
  languages_json: string | null;
  checked_on: string | null;
}

/** Resolves a slug or alias to the active app row. */
export async function findApp(ctx: Ctx, slug: string): Promise<AppFactsRow | null> {
  return ctx.db.first<AppFactsRow>(
    `SELECT ${APP_COLS}, a.app_store_handle, a.app_store_category, a.launched_on, a.plans_json,
       a.features_json, a.works_with_json, a.languages_json, a.checked_on
     ${APP_FROM}
     WHERE a.status = 'active' AND (a.slug = ? OR a.id = (SELECT app_id FROM app_aliases WHERE slug = ?))`,
    [slug, slug],
  );
}

/** `findApp` for several slugs or aliases in one query, keyed by the slug as given. */
export async function findApps(
  ctx: Ctx,
  slugs: readonly string[],
): Promise<Map<string, AppFactsRow>> {
  const rows = await ctx.db.all<AppFactsRow & { req_slug: string }>(
    `SELECT j.value AS req_slug, ${APP_COLS}, a.app_store_handle, a.app_store_category,
       a.launched_on, a.plans_json, a.features_json, a.works_with_json, a.languages_json,
       a.checked_on
     ${APP_FROM}
     JOIN json_each(?) j
       ON a.slug = j.value OR a.id = (SELECT app_id FROM app_aliases WHERE slug = j.value)
     WHERE a.status = 'active'`,
    [jsonIds([...new Set(slugs)])],
  );
  const out = new Map<string, AppFactsRow>();
  for (const { req_slug, ...row } of rows) if (!out.has(req_slug)) out.set(req_slug, row);
  return out;
}

function parsePlans(json: string | null): AppPlan[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.flatMap((p: unknown): AppPlan[] => {
      if (!p || typeof p !== 'object') return [];
      const o = p as Record<string, unknown>;
      const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);
      const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : null);
      return [
        {
          name: str('name') ?? 'Plan',
          price_label: str('price_label') ?? '',
          price_cents: num('price_cents'),
          period: str('period'),
          trial_days: num('trial_days'),
          features: Array.isArray(o.features)
            ? o.features.filter((f): f is string => typeof f === 'string')
            : [],
        },
      ];
    });
  } catch {
    return [];
  }
}

type AppStoreDbRow = StoreThemeRow & {
  domain: string;
  name: string | null;
  is_curated: number;
  app_count: number;
  is_captured: number;
  first_seen: string;
  list_position: number;
};

const APP_STORE_COLS = `s.domain, s.name, s.is_curated, s.app_count, s.is_captured, sa.first_seen,
  s.list_position, ${STORE_THEME_COLS}`;
const APP_STORE_FROM = `FROM store_apps sa
  JOIN stores s ON s.id = sa.store_id AND s.status = 'active'
  LEFT JOIN themes t ON t.id = s.current_theme_id`;

type AppStorePage = { items: AppStoreRow[]; next_cursor: string | null; total: number };

/** A page of store rows (`rows` holds up to limit + 1, the extra one only signals more). */
function appStorePage(rows: AppStoreDbRow[], limit: number, total: number): AppStorePage {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      store: storeRef(r),
      theme: storeThemeInfo(r),
      app_count: r.app_count,
      is_captured: bool(r.is_captured),
      first_seen: r.first_seen,
    })),
    next_cursor: rows.length > limit && last ? encodeCursor([last.list_position]) : null,
    total,
  };
}

export async function appStores(
  ctx: Ctx,
  appId: number,
  limit: number,
  cursor?: string,
): Promise<AppStorePage> {
  const params: SqlValue[] = [appId];
  let seek = '';
  if (cursor) {
    const [pos] = decodeCursor(cursor, 1);
    seek = 'AND s.list_position > ?';
    params.push(pos ?? 0);
  }
  const [rows, total] = await Promise.all([
    limit === 0
      ? Promise.resolve([])
      : ctx.db.all<AppStoreDbRow>(
          `SELECT ${APP_STORE_COLS} ${APP_STORE_FROM}
           WHERE sa.app_id = ? AND sa.removed_at IS NULL ${seek}
           ORDER BY s.list_position LIMIT ?`,
          [...params, limit + 1],
        ),
    ctx.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM store_apps sa JOIN stores s ON s.id = sa.store_id AND s.status = 'active'
       WHERE sa.app_id = ? AND sa.removed_at IS NULL`,
      [appId],
    ),
  ]);
  return appStorePage(rows, limit, total?.n ?? 0);
}

/** The first page of `appStores` for each app, with its total, in one windowed query. */
async function appStoresFirstPages(
  ctx: Ctx,
  appIds: readonly number[],
  limit: number,
): Promise<Map<number, AppStorePage>> {
  const rows = await ctx.db.all<AppStoreDbRow & { g_app: number; g_rn: number; g_total: number }>(
    `SELECT * FROM (
       SELECT sa.app_id AS g_app, ${APP_STORE_COLS},
         ROW_NUMBER() OVER (PARTITION BY sa.app_id ORDER BY s.list_position) AS g_rn,
         COUNT(*) OVER (PARTITION BY sa.app_id) AS g_total
       ${APP_STORE_FROM}
       WHERE sa.app_id IN (SELECT value FROM json_each(?)) AND sa.removed_at IS NULL
     ) WHERE g_rn <= ? ORDER BY g_app, g_rn`,
    [jsonIds(appIds), limit + 1],
  );
  const byApp = groupBy(rows, (r) => r.g_app);
  return new Map(
    appIds.map((id) => {
      const mine = byApp.get(id) ?? [];
      return [id, appStorePage(mine, limit, mine[0]?.g_total ?? 0)];
    }),
  );
}

export async function alternativeApps(
  ctx: Ctx,
  app: AppRow,
  limit: number,
): Promise<AppListItem[]> {
  if (app.category_id === null) return [];
  const rows = await ctx.db.all<AppRow>(
    `${APP_SELECT} WHERE a.status = 'active' AND a.category_id = ? AND a.id <> ?
     ORDER BY store_count DESC, a.rating IS NULL, a.rating DESC, a.name LIMIT ?`,
    [app.category_id, app.id, limit],
  );
  return hydrateApps(ctx, rows);
}

export async function getAppDetail(
  ctx: Ctx,
  slug: string,
  opts: { storesLimit: number; sectionsLimit?: number },
): Promise<AppDetail> {
  const row = await findApp(ctx, slug);
  if (!row) throw notFound(`App '${slug}'`);
  const [detail] = await appDetails(ctx, [row], opts);
  if (!detail) throw notFound(`App '${slug}'`);
  return detail;
}

/** Rows of a per-app windowed list: the app it belongs to and its rank there. */
type PerApp<T> = T & { g_app: number; g_rn: number };
const byApp = <T extends { g_app: number }>(rows: readonly T[]) => groupBy(rows, (r) => r.g_app);

/**
 * App details for several apps at once (the compare page shows two), with the same number of
 * queries as one: every per-app list is one windowed query over all of them.
 */
export async function appDetails(
  ctx: Ctx,
  rows: readonly AppFactsRow[],
  opts: { storesLimit: number; sectionsLimit?: number },
): Promise<AppDetail[]> {
  if (rows.length === 0) return [];
  const appIds = rows.map((r) => r.id);
  const ids = jsonIds(appIds);
  const sectionsLimit = Math.max(0, Math.floor(opts.sectionsLimit ?? 24));
  const inApps = 'IN (SELECT value FROM json_each(?))';

  const [aliases, sections, curated, stores, coInstalled, altRows, links, themes] =
    await Promise.all([
      ctx.db.all<{ g_app: number; slug: string }>(
        `SELECT app_id AS g_app, slug FROM app_aliases WHERE app_id ${inApps} ORDER BY app_id, slug`,
        [ids],
      ),
      groupedSectionCards(ctx, {
        group: 's.app_id',
        where: `s.app_id ${inApps} AND s.is_current = 1`,
        params: [ids],
        order: 'st.list_position, s.device, s.id',
        per: sectionsLimit,
      }),
      ctx.db.all<PerApp<{ id: number; domain: string; name: string | null; is_curated: number }>>(
        `SELECT * FROM (
           SELECT sa.app_id AS g_app, s.id, s.domain, s.name, s.is_curated,
             ROW_NUMBER() OVER (PARTITION BY sa.app_id ORDER BY s.list_position) AS g_rn
           FROM store_apps sa
           JOIN stores s ON s.id = sa.store_id AND s.status = 'active'
           WHERE sa.app_id ${inApps} AND sa.removed_at IS NULL
             AND EXISTS (SELECT 1 FROM screenshots sh WHERE sh.store_id = s.id AND sh.is_current = 1)
         ) WHERE g_rn <= 12 ORDER BY g_app, g_rn`,
        [ids],
      ),
      appStoresFirstPages(ctx, appIds, opts.storesLimit),
      ctx.db.all<PerApp<AppRefRow & { stores: number }>>(
        `SELECT * FROM (
           SELECT c.app_id AS g_app, c.store_count AS stores, ${APP_REF_COLS},
             ROW_NUMBER() OVER (PARTITION BY c.app_id ORDER BY c.store_count DESC, a.slug) AS g_rn
           FROM app_co_installs c
           JOIN apps a ON a.id = c.other_app_id AND a.status = 'active'
           LEFT JOIN app_categories ac ON ac.id = a.category_id
           WHERE c.app_id ${inApps}
         ) WHERE g_rn <= 12 ORDER BY g_app, g_rn`,
        [ids],
      ),
      // Alternatives: the most used other apps of the same category (as alternativeApps).
      ctx.db.all<PerApp<AppRow>>(
        `SELECT * FROM (
           SELECT r.id AS g_app, ${APP_COLS},
             ROW_NUMBER() OVER (
               PARTITION BY r.id
               ORDER BY COALESCE(st.store_count, 0) DESC, a.rating IS NULL, a.rating DESC, a.name, a.id
             ) AS g_rn
           FROM apps r
           JOIN apps a ON a.category_id = r.category_id AND a.id <> r.id AND a.status = 'active'
           LEFT JOIN app_categories ac ON ac.id = a.category_id
           LEFT JOIN app_stats st ON st.app_id = a.id
           WHERE r.id ${inApps}
         ) WHERE g_rn <= 8 ORDER BY g_app, g_rn`,
        [ids],
      ),
      comparisonLinks(ctx, { kind: 'app', entityIds: appIds, limit: 500 }),
      ctx.db.all<PerApp<{ slug: string; name: string; vendor: string | null; stores: number }>>(
        `SELECT * FROM (
           SELECT u.app_id AS g_app, t.slug, t.name, t.vendor, u.store_count AS stores,
             ROW_NUMBER() OVER (PARTITION BY u.app_id ORDER BY u.store_count DESC, t.slug) AS g_rn
           FROM theme_app_usage u JOIN themes t ON t.id = u.theme_id AND t.status = 'active'
           WHERE u.app_id ${inApps}
         ) WHERE g_rn <= 8 ORDER BY g_app, g_rn`,
        [ids],
      ),
    ]);

  // Second round: listing data (CTA links) for the apps and all their alternatives, and the
  // home previews of every curated store, each in one query.
  const [items, previews] = await Promise.all([
    hydrateApps(ctx, [...rows, ...altRows]),
    homePreviews(ctx, [...new Set(curated.map((c) => c.id))]),
  ]);
  const itemById = new Map<number, AppListItem>();
  [...rows, ...altRows].forEach((r, i) => {
    const item = items[i];
    if (item) itemById.set(r.id, item);
  });
  const aliasesOf = byApp(aliases);
  const curatedOf = byApp(curated);
  const coOf = byApp(coInstalled);
  const altOf = byApp(altRows);
  const themesOf = byApp(themes);

  return rows.flatMap((row): AppDetail[] => {
    const item = itemById.get(row.id);
    if (!item) return [];
    const mine = sections.get(row.id);
    const cards = mine?.cards ?? [];
    const cardsByStore = new Map<string, SectionCard[]>();
    for (const c of cards)
      cardsByStore.set(c.store.domain, [...(cardsByStore.get(c.store.domain) ?? []), c]);
    const facts: AppFacts = {
      ...item,
      app_store_handle: row.app_store_handle,
      app_store_url: row.app_store_url,
      website_url: row.website_url,
      app_store_category: row.app_store_category,
      launched_on: row.launched_on,
      plans: parsePlans(row.plans_json),
      features: parseStringArray(row.features_json),
      works_with: parseStringArray(row.works_with_json),
      languages: parseStringArray(row.languages_json),
      checked_on: row.checked_on,
      facts_source: SOURCE_IDS.appStore,
      aliases: (aliasesOf.get(row.id) ?? []).map((a) => a.slug),
    };
    return [
      {
        app: facts,
        surfaces: categorySurfaces(row.app_cat_name),
        seen_on: {
          stores: (curatedOf.get(row.id) ?? []).map((c) => ({
            store: storeRef(c),
            preview: previews.get(c.id) ?? null,
            sections: cardsByStore.get(c.domain) ?? [],
          })),
          sections: cards,
          section_total: mine?.total ?? 0,
        },
        stores: stores.get(row.id) ?? appStorePage([], opts.storesLimit, 0),
        co_installed: (coOf.get(row.id) ?? []).map((r) => ({
          app: appRef(r),
          stores: r.stores,
          share: ratio(r.stores, row.store_count),
        })),
        alternatives: (altOf.get(row.id) ?? []).flatMap((r) => itemById.get(r.id) ?? []),
        comparisons: links
          .filter((l) => l.a.slug === row.app_slug || l.b.slug === row.app_slug)
          .slice(0, 12),
        themes: (themesOf.get(row.id) ?? []).map((t) => ({
          theme: themeRef(t),
          stores: t.stores,
          share: ratio(t.stores, row.store_count),
        })),
      },
    ];
  });
}

/** Category names that render a section type (for section type info). */
export const categoriesForSection = (type: string): string[] =>
  Object.entries(APP_CATEGORY_SURFACES)
    .filter(([, surfaces]) => surfaces.some((s) => s === type))
    .map(([name]) => name);
