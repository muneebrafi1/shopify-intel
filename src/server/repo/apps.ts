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
  parseStringArray,
  ratio,
  storeRef,
  storeThemeInfo,
  themeRef,
  usageStat,
  type AppRefRow,
  type StoreThemeRow,
} from './refs.ts';
import { homePreviews, sectionCards } from './visual.ts';

const APP_COLS = `a.id, ${APP_REF_COLS}, a.developer, a.tagline, a.rating, a.reviews,
  a.free_plan, a.from_price_cents, a.trial_days, a.built_for_shopify, a.profile,
  a.app_store_url, a.website_url, a.category_id,
  COALESCE(st.store_count, 0) AS store_count, st.denominator, st.rank_overall,
  COALESCE(st.section_count, 0) AS section_count`;
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
  sort: 'usage' | 'rating' | 'reviews' | 'name';
  cursor?: string | undefined;
  limit: number;
}

function appWhere(p: ListAppsParams, omitCategory = false) {
  const where = ["a.status = 'active'"];
  const params: SqlValue[] = [];
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

const APP_ORDER = {
  usage: 'store_count DESC, a.name',
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
    ctx.db.all<Facet>(
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
interface AppFactsRow extends AppRow {
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

export async function appStores(
  ctx: Ctx,
  appId: number,
  limit: number,
  cursor?: string,
): Promise<{ items: AppStoreRow[]; next_cursor: string | null; total: number }> {
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
      : ctx.db.all<
          StoreThemeRow & {
            domain: string;
            name: string | null;
            is_curated: number;
            app_count: number;
            is_captured: number;
            first_seen: string;
            list_position: number;
          }
        >(
          `SELECT s.domain, s.name, s.is_curated, s.app_count, s.is_captured, sa.first_seen,
             s.list_position, ${STORE_THEME_COLS}
           FROM store_apps sa
           JOIN stores s ON s.id = sa.store_id AND s.status = 'active'
           LEFT JOIN themes t ON t.id = s.current_theme_id
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
    total: total?.n ?? 0,
  };
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
  const sectionsLimit = Math.max(0, Math.floor(opts.sectionsLimit ?? 24));

  const [
    [item],
    aliases,
    sections,
    sectionTotal,
    curated,
    stores,
    coInstalled,
    alternatives,
    comparisons,
    themes,
  ] = await Promise.all([
    hydrateApps(ctx, [row]),
    ctx.db.all<{ slug: string }>('SELECT slug FROM app_aliases WHERE app_id = ? ORDER BY slug', [
      row.id,
    ]),
    sectionCards(
      ctx,
      's.app_id = ? AND s.is_current = 1',
      [row.id],
      `ORDER BY st.list_position, s.device, s.id LIMIT ${sectionsLimit}`,
    ),
    ctx.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sections s JOIN stores st ON st.id = s.store_id AND st.status = 'active'
         WHERE s.app_id = ? AND s.is_current = 1`,
      [row.id],
    ),
    ctx.db.all<{ id: number; domain: string; name: string | null; is_curated: number }>(
      `SELECT s.id, s.domain, s.name, s.is_curated FROM store_apps sa
         JOIN stores s ON s.id = sa.store_id AND s.status = 'active'
         WHERE sa.app_id = ? AND sa.removed_at IS NULL
           AND EXISTS (SELECT 1 FROM screenshots sh WHERE sh.store_id = s.id AND sh.is_current = 1)
         ORDER BY s.list_position LIMIT 12`,
      [row.id],
    ),
    appStores(ctx, row.id, opts.storesLimit),
    ctx.db.all<AppRefRow & { stores: number }>(
      `SELECT c.store_count AS stores, ${APP_REF_COLS}
         FROM app_co_installs c
         JOIN apps a ON a.id = c.other_app_id AND a.status = 'active'
         LEFT JOIN app_categories ac ON ac.id = a.category_id
         WHERE c.app_id = ? ORDER BY c.store_count DESC, a.slug LIMIT 12`,
      [row.id],
    ),
    alternativeApps(ctx, row, 8),
    comparisonLinks(ctx, { kind: 'app', entityId: row.id, limit: 12 }),
    ctx.db.all<{ slug: string; name: string; vendor: string | null; stores: number }>(
      `SELECT t.slug, t.name, t.vendor, u.store_count AS stores
         FROM theme_app_usage u JOIN themes t ON t.id = u.theme_id AND t.status = 'active'
         WHERE u.app_id = ? ORDER BY u.store_count DESC, t.slug LIMIT 8`,
      [row.id],
    ),
  ]);
  if (!item) throw notFound(`App '${slug}'`);

  const previews = await homePreviews(
    ctx,
    curated.map((c) => c.id),
  );
  const cardsByStore = new Map<string, SectionCard[]>();
  for (const c of sections)
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
    aliases: aliases.map((a) => a.slug),
  };
  return {
    app: facts,
    surfaces: categorySurfaces(row.app_cat_name),
    seen_on: {
      stores: curated.map((c) => ({
        store: storeRef(c),
        preview: previews.get(c.id) ?? null,
        sections: cardsByStore.get(c.domain) ?? [],
      })),
      sections,
      section_total: sectionTotal?.n ?? 0,
    },
    stores,
    co_installed: coInstalled.map((r) => ({
      app: appRef(r),
      stores: r.stores,
      share: ratio(r.stores, row.store_count),
    })),
    alternatives,
    comparisons,
    themes: themes.map((t) => ({
      theme: themeRef(t),
      stores: t.stores,
      share: ratio(t.stores, row.store_count),
    })),
  };
}

/** Category names that render a section type (for section type info). */
export const categoriesForSection = (type: string): string[] =>
  Object.entries(APP_CATEGORY_SURFACES)
    .filter(([, surfaces]) => surfaces.some((s) => s === type))
    .map(([name]) => name);
