/** Store queries: list (filters, facets, keyset pages), detail and list-item hydration. */
import { PIXELS } from '../../lib/taxonomy.ts';
import type { Ctx } from '../api/v1/context.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import { notFound } from '../api/v1/errors.ts';
import { decodeCursor, keysetWhere, orderBy, pageOf, type SortKey } from '../api/v1/pagination.ts';
import type { AppRef, Facet, StoreRef } from '../api/v1/schemas/common.ts';
import type {
  StoreApp,
  StoreDetail,
  StoreFacets,
  StoreListItem,
  StorePage,
} from '../api/v1/schemas/stores.ts';
import type { SqlValue } from '../db/types.ts';
import { normalizeDomain } from '../lib/slug.ts';
import { ftsPrefixQuery } from './fts.ts';
import {
  APP_REF_COLS,
  STORE_THEME_COLS,
  appRef,
  bool,
  categorySurfaces,
  jsonIds,
  pageTypeRef,
  sectionTypeRef,
  storeRef,
  storeThemeInfo,
  type AppRefRow,
  type StoreThemeRow,
} from './refs.ts';
import { homePreviews, screenshotDetails, THUMB_COLS, toThumb, type ThumbRow } from './visual.ts';

// ---------------------------------------------------------------------------------------------
// Rows and hydration
// ---------------------------------------------------------------------------------------------
export const STORE_COLS = `s.id, s.domain, s.name, s.url, s.country, s.currency,
  s.category_slug, sc.name AS category_name, s.tranco_rank, s.is_curated, s.is_captured,
  ${STORE_THEME_COLS}, s.app_count, s.first_seen, s.last_seen, s.list_position`;
export const STORE_FROM = `FROM stores s
LEFT JOIN themes t ON t.id = s.current_theme_id
LEFT JOIN store_categories sc ON sc.slug = s.category_slug`;
export const STORE_SELECT = `SELECT ${STORE_COLS} ${STORE_FROM}`;

export interface StoreRow extends StoreThemeRow {
  id: number;
  domain: string;
  name: string | null;
  url: string | null;
  country: string | null;
  currency: string | null;
  category_slug: string | null;
  category_name: string | null;
  tranco_rank: number | null;
  is_curated: number;
  is_captured: number;
  app_count: number;
  first_seen: string;
  last_seen: string;
  list_position: number;
}

/** Top apps (most used first) per store, max `perStore`. */
async function topAppsByStore(
  ctx: Ctx,
  storeIds: readonly number[],
  perStore: number,
): Promise<Map<number, AppRef[]>> {
  const out = new Map<number, AppRef[]>();
  if (storeIds.length === 0) return out;
  const rows = await ctx.db.all<AppRefRow & { store_id: number }>(
    `SELECT sa.store_id, ${APP_REF_COLS}
     FROM store_apps sa
     JOIN apps a ON a.id = sa.app_id AND a.status = 'active'
     LEFT JOIN app_categories ac ON ac.id = a.category_id
     LEFT JOIN app_stats st ON st.app_id = a.id
     WHERE sa.store_id IN (SELECT value FROM json_each(?)) AND sa.removed_at IS NULL
     ORDER BY sa.store_id, st.store_count DESC, a.slug`,
    [jsonIds(storeIds)],
  );
  for (const r of rows) {
    const list = out.get(r.store_id) ?? [];
    if (list.length < perStore) list.push(appRef(r));
    out.set(r.store_id, list);
  }
  return out;
}

function toStoreListItem(
  r: StoreRow,
  topApps: AppRef[],
  preview: StoreListItem['preview'],
): StoreListItem {
  return {
    ...storeRef(r),
    url: r.url ?? `https://${r.domain}`,
    country: r.country,
    currency: r.currency,
    category:
      r.category_slug && r.category_name
        ? {
            slug: r.category_slug,
            name: r.category_name,
            href: hrefs.storeCategory(r.category_slug),
          }
        : null,
    tranco_rank: r.tranco_rank,
    is_captured: bool(r.is_captured),
    theme: storeThemeInfo(r),
    app_count: r.app_count,
    top_apps: topApps,
    preview,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    position: r.list_position,
  };
}

export async function hydrateStoreItems(ctx: Ctx, rows: StoreRow[]): Promise<StoreListItem[]> {
  const ids = rows.map((r) => r.id);
  const [apps, previews] = await Promise.all([topAppsByStore(ctx, ids, 5), homePreviews(ctx, ids)]);
  return rows.map((r) => toStoreListItem(r, apps.get(r.id) ?? [], previews.get(r.id) ?? null));
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------
export interface StoreFilters {
  /** theme_id, or a lower-cased detected name for themes without a record. */
  theme?: { id: number } | { nameKey: string } | { none: true };
  appId?: number | null;
  category?: string;
  currency?: string;
  country?: string;
  curated?: boolean;
  captured?: boolean;
  fts?: string | null;
  /** Exact (normalised) domains. */
  domains?: readonly string[];
}
type FilterKey = keyof StoreFilters;

export async function resolveThemeFilter(
  ctx: Ctx,
  slug: string,
): Promise<NonNullable<StoreFilters['theme']>> {
  const theme = await ctx.db.first<{ id: number }>(
    "SELECT id FROM themes WHERE slug = ? AND status = 'active'",
    [slug],
  );
  if (theme) return { id: theme.id };
  // Detected themes we have no record for are addressed by their slugified name.
  const name = await ctx.db.first<{ n: string }>(
    `SELECT lower(current_theme_name) AS n FROM stores
     WHERE current_theme_name IS NOT NULL AND lower(replace(current_theme_name, ' ', '-')) = ?
     LIMIT 1`,
    [slug.toLowerCase()],
  );
  return name ? { nameKey: name.n } : { none: true };
}

export async function resolveAppId(ctx: Ctx, slug: string): Promise<number | null> {
  const row = await ctx.db.first<{ id: number }>(
    `SELECT id FROM apps WHERE slug = ? AND status = 'active'
     UNION ALL SELECT app_id AS id FROM app_aliases WHERE slug = ?
     LIMIT 1`,
    [slug, slug],
  );
  return row?.id ?? null;
}

function storeWhere(f: StoreFilters, omit: readonly FilterKey[] = []) {
  const where: string[] = ["s.status = 'active'"];
  const params: SqlValue[] = [];
  const use = (k: FilterKey) => f[k] !== undefined && !omit.includes(k);
  if (use('theme') && f.theme) {
    if ('id' in f.theme) {
      where.push('s.current_theme_id = ?');
      params.push(f.theme.id);
    } else if ('nameKey' in f.theme) {
      where.push('lower(s.current_theme_name) = ?');
      params.push(f.theme.nameKey);
    } else {
      where.push('0');
    }
  }
  if (use('appId')) {
    if (f.appId === null) where.push('0');
    else {
      where.push(
        'EXISTS (SELECT 1 FROM store_apps sa WHERE sa.store_id = s.id AND sa.app_id = ? AND sa.removed_at IS NULL)',
      );
      params.push(f.appId ?? 0);
    }
  }
  if (use('category')) {
    where.push('s.category_slug = ?');
    params.push(f.category ?? '');
  }
  if (use('currency')) {
    where.push('s.currency = ?');
    params.push((f.currency ?? '').toUpperCase());
  }
  if (use('country')) {
    where.push('s.country = ?');
    params.push((f.country ?? '').toUpperCase());
  }
  if (use('curated')) where.push(`s.is_curated = ${f.curated ? 1 : 0}`);
  if (use('captured')) where.push(`s.is_captured = ${f.captured ? 1 : 0}`);
  if (use('domains')) {
    where.push('s.domain IN (SELECT value FROM json_each(?))');
    params.push(jsonIds(f.domains ?? []));
  }
  if (use('fts')) {
    if (f.fts === null) where.push('0');
    else {
      where.push(
        "s.domain IN (SELECT ref FROM search_index WHERE search_index MATCH ? AND kind = 'store')",
      );
      params.push(f.fts ?? '');
    }
  }
  return { sql: where.join(' AND '), params };
}

const isUnfiltered = (f: StoreFilters, omit: readonly FilterKey[]) =>
  (Object.keys(f) as FilterKey[]).every((k) => f[k] === undefined || omit.includes(k));

async function storeFacets(ctx: Ctx, f: StoreFilters): Promise<StoreFacets> {
  const facet = async (
    key: FilterKey,
    sql: (where: string) => string,
  ): Promise<Array<{ value: string | null; label: string | null; count: number }>> => {
    const w = storeWhere(f, [key]);
    return ctx.db.all(sql(w.sql), w.params);
  };
  const toFacets = (rows: Array<{ value: string | null; label: string | null; count: number }>) =>
    rows
      .filter((r): r is { value: string; label: string | null; count: number } => r.value !== null)
      .map((r): Facet => ({ value: r.value, label: r.label ?? r.value, count: r.count }));

  const appFacetSql = isUnfiltered(f, ['appId'])
    ? // Fast path: unfiltered app counts come from the summary table.
      Promise.resolve(
        ctx.db.all<{ value: string; label: string; count: number }>(
          `SELECT a.slug AS value, a.name AS label, st.store_count AS count
           FROM app_stats st JOIN apps a ON a.id = st.app_id AND a.status = 'active'
           WHERE st.store_count > 0 ORDER BY st.store_count DESC, a.slug LIMIT 20`,
        ),
      )
    : facet(
        'appId',
        (w) => `SELECT a.slug AS value, a.name AS label, COUNT(*) AS count
          FROM stores s JOIN store_apps sa ON sa.store_id = s.id AND sa.removed_at IS NULL
          JOIN apps a ON a.id = sa.app_id AND a.status = 'active'
          WHERE ${w} GROUP BY a.id ORDER BY count DESC, a.slug LIMIT 20`,
      );

  const flags = storeWhere(f, ['curated', 'captured']);
  const scoped = storeWhere(f, ['curated']);
  const [themes, categories, currencies, countries, apps, flagRow, scopeRow] = await Promise.all([
    facet(
      'theme',
      (w) => `SELECT COALESCE(t.slug, lower(replace(s.current_theme_name, ' ', '-'))) AS value,
          COALESCE(t.name, s.current_theme_name) AS label, COUNT(*) AS count
        FROM stores s LEFT JOIN themes t ON t.id = s.current_theme_id
        WHERE ${w} AND s.current_theme_name IS NOT NULL
        GROUP BY value ORDER BY count DESC, value LIMIT 30`,
    ),
    facet(
      'category',
      (w) => `SELECT s.category_slug AS value, sc.name AS label, COUNT(*) AS count
        FROM stores s JOIN store_categories sc ON sc.slug = s.category_slug
        WHERE ${w} GROUP BY s.category_slug ORDER BY count DESC, value`,
    ),
    facet(
      'currency',
      (w) => `SELECT s.currency AS value, s.currency AS label, COUNT(*) AS count
        FROM stores s WHERE ${w} AND s.currency IS NOT NULL
        GROUP BY s.currency ORDER BY count DESC, value LIMIT 30`,
    ),
    facet(
      'country',
      (w) => `SELECT s.country AS value, s.country AS label, COUNT(*) AS count
        FROM stores s WHERE ${w} AND s.country IS NOT NULL
        GROUP BY s.country ORDER BY count DESC, value`,
    ),
    appFacetSql,
    ctx.db.first<{ curated: number | null; captured: number | null }>(
      `SELECT SUM(s.is_curated) AS curated, SUM(s.is_captured) AS captured FROM stores s WHERE ${flags.sql}`,
      flags.params,
    ),
    ctx.db.first<{ curated: number | null; all: number }>(
      `SELECT SUM(s.is_curated) AS curated, COUNT(*) AS "all" FROM stores s WHERE ${scoped.sql}`,
      scoped.params,
    ),
  ]);
  return {
    themes: toFacets(themes),
    categories: toFacets(categories),
    currencies: toFacets(currencies),
    countries: toFacets(countries),
    apps: toFacets(apps),
    curated: flagRow?.curated ?? 0,
    captured: flagRow?.captured ?? 0,
    scope: { curated: scopeRow?.curated ?? 0, all: scopeRow?.all ?? 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------
const SORTS: Record<'rank' | 'apps' | 'recent' | 'domain', SortKey<StoreRow>[]> = {
  rank: [{ expr: 's.list_position', dir: 'asc', pick: (r) => r.list_position }],
  apps: [
    { expr: 's.app_count', dir: 'desc', pick: (r) => r.app_count },
    { expr: 's.domain', dir: 'asc', pick: (r) => r.domain },
  ],
  recent: [
    { expr: 's.last_seen', dir: 'desc', pick: (r) => r.last_seen },
    { expr: 's.domain', dir: 'asc', pick: (r) => r.domain },
  ],
  domain: [{ expr: 's.domain', dir: 'asc', pick: (r) => r.domain }],
};

export interface ListStoresParams {
  theme?: string | undefined;
  app?: string | undefined;
  category?: string | undefined;
  currency?: string | undefined;
  country?: string | undefined;
  /** Owner decision: lists default to the curated stores, with or without filters. */
  scope?: 'curated' | 'all' | undefined;
  curated?: boolean | undefined;
  captured?: boolean | undefined;
  q?: string | undefined;
  /** Only these stores (domains, normalised like the detail route). */
  domains?: readonly string[] | undefined;
  sort: keyof typeof SORTS;
  cursor?: string | undefined;
  limit: number;
  /** false: skip the facet queries (facets come back empty: no values, zero counts). */
  facets?: boolean | undefined;
}

/** Facets left out on request (`facets: false`): the same shape, nothing counted. */
const noStoreFacets = (): StoreFacets => ({
  themes: [],
  categories: [],
  currencies: [],
  countries: [],
  apps: [],
  curated: 0,
  captured: 0,
  scope: { curated: 0, all: 0 },
});

export async function listStores(ctx: Ctx, p: ListStoresParams) {
  const f: StoreFilters = {};
  if (p.theme) f.theme = await resolveThemeFilter(ctx, p.theme);
  if (p.app) f.appId = await resolveAppId(ctx, p.app);
  if (p.category) f.category = p.category;
  if (p.currency) f.currency = p.currency;
  if (p.country) f.country = p.country;
  // An explicit `curated` wins; otherwise the scope decides (curated by default).
  if (p.curated !== undefined) f.curated = p.curated;
  else if ((p.scope ?? 'curated') === 'curated') f.curated = true;
  if (p.captured !== undefined) f.captured = p.captured;
  if (p.q?.trim()) f.fts = ftsPrefixQuery(p.q);
  if (p.domains) f.domains = p.domains.map((d) => normalizeDomain(d) ?? d);

  const keys = SORTS[p.sort];
  const w = storeWhere(f);
  const conds = [w.sql];
  const params = [...w.params];
  if (p.cursor) {
    const k = keysetWhere(keys, decodeCursor(p.cursor, keys.length));
    conds.push(k.sql);
    params.push(...k.params);
  }
  const [rows, total, facets] = await Promise.all([
    ctx.db.all<StoreRow>(
      `${STORE_SELECT} WHERE ${conds.join(' AND ')} ORDER BY ${orderBy(keys)} LIMIT ?`,
      [...params, p.limit + 1],
    ),
    ctx.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM stores s WHERE ${w.sql}`, w.params),
    p.facets === false ? Promise.resolve(noStoreFacets()) : storeFacets(ctx, f),
  ]);
  const page = pageOf(rows, p.limit, keys);
  return {
    items: await hydrateStoreItems(ctx, page.rows),
    facets,
    pagination: { limit: p.limit, next_cursor: page.nextCursor, total: total?.n ?? 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------
export async function findActiveStore(ctx: Ctx, domainInput: string): Promise<StoreRow | null> {
  const domain = normalizeDomain(domainInput);
  if (!domain) return null;
  return ctx.db.first<StoreRow>(`${STORE_SELECT} WHERE s.domain = ? AND s.status = 'active'`, [
    domain,
  ]);
}

interface StoreAppRow extends AppRefRow {
  app_id: number;
  confidence: number | null;
  first_seen: string;
  last_seen: string;
  store_count: number | null;
}

function assembleStoreApps(
  rows: StoreAppRow[],
  unresolved: { detection_slug: string }[],
  seen: { app_id: number; section_type: string }[],
): StoreDetail['apps'] {
  const groups: StoreDetail['apps']['groups'] = [];
  for (const r of rows) {
    const app: StoreApp = {
      ...appRef(r),
      confidence: r.confidence,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      seen_in: seen.filter((s) => s.app_id === r.app_id).map((s) => sectionTypeRef(s.section_type)),
      surfaces: categorySurfaces(r.app_cat_name),
    };
    const last = groups[groups.length - 1];
    if (last && last.category?.slug === app.category?.slug) last.apps.push(app);
    else groups.push({ category: app.category, apps: [app] });
  }
  return {
    total: rows.length + unresolved.length,
    resolved: rows.length,
    unresolved: { count: unresolved.length, slugs: unresolved.map((u) => u.detection_slug) },
    groups,
  };
}

function assembleStorePages(
  pages: { id: number; page_type: string; url: string | null; is_placeholder: number }[],
  shots: { id: number; page_id: number; device: string }[],
  details: Awaited<ReturnType<typeof screenshotDetails>>,
): StorePage[] {
  const pick = (pageId: number, device: string) => {
    const shot = shots.find((s) => s.page_id === pageId && s.device === device);
    return shot ? (details.get(shot.id) ?? null) : null;
  };
  return pages.map((p) => ({
    page_type: pageTypeRef(p.page_type),
    url: p.url,
    is_placeholder: bool(p.is_placeholder),
    screenshots: { desktop: pick(p.id, 'desktop'), mobile: pick(p.id, 'mobile') },
  }));
}

async function storeApps(ctx: Ctx, storeId: number): Promise<StoreDetail['apps']> {
  const [rows, unresolved, seen] = (await ctx.db.allBatch([
    {
      sql: `SELECT a.id AS app_id, sa.confidence, sa.first_seen, sa.last_seen, st.store_count, ${APP_REF_COLS}
       FROM store_apps sa
       JOIN apps a ON a.id = sa.app_id AND a.status = 'active'
       LEFT JOIN app_categories ac ON ac.id = a.category_id
       LEFT JOIN app_stats st ON st.app_id = a.id
       WHERE sa.store_id = ? AND sa.removed_at IS NULL
       ORDER BY ac.position IS NULL, ac.position, st.store_count DESC, a.slug`,
      params: [storeId],
    },
    {
      sql: `SELECT detection_slug FROM store_unresolved_apps
       WHERE store_id = ? AND removed_at IS NULL ORDER BY detection_slug`,
      params: [storeId],
    },
    {
      sql: `SELECT DISTINCT app_id, section_type FROM sections
       WHERE store_id = ? AND is_current = 1 AND app_id IS NOT NULL ORDER BY section_type`,
      params: [storeId],
    },
  ])) as [StoreAppRow[], { detection_slug: string }[], { app_id: number; section_type: string }[]];
  const groups: StoreDetail['apps']['groups'] = [];
  for (const r of rows) {
    const app: StoreApp = {
      ...appRef(r),
      confidence: r.confidence,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      seen_in: seen.filter((s) => s.app_id === r.app_id).map((s) => sectionTypeRef(s.section_type)),
      surfaces: categorySurfaces(r.app_cat_name),
    };
    const last = groups[groups.length - 1];
    if (last && last.category?.slug === app.category?.slug) last.apps.push(app);
    else groups.push({ category: app.category, apps: [app] });
  }
  return {
    total: rows.length + unresolved.length,
    resolved: rows.length,
    unresolved: { count: unresolved.length, slugs: unresolved.map((u) => u.detection_slug) },
    groups,
  };
}

async function storePages(ctx: Ctx, storeId: number): Promise<StorePage[]> {
  const pages = await ctx.db.all<{
    id: number;
    page_type: string;
    url: string | null;
    is_placeholder: number;
  }>('SELECT id, page_type, url, is_placeholder FROM pages WHERE store_id = ? ORDER BY id', [
    storeId,
  ]);
  const shots = await ctx.db.all<{ id: number; page_id: number; device: string }>(
    `SELECT id, page_id, device FROM screenshots
     WHERE store_id = ? AND is_current = 1 ORDER BY is_placeholder, id`,
    [storeId],
  );
  const details = await screenshotDetails(
    ctx,
    shots.map((s) => s.id),
  );
  const pick = (pageId: number, device: string) => {
    const shot = shots.find((s) => s.page_id === pageId && s.device === device);
    return shot ? (details.get(shot.id) ?? null) : null;
  };
  return pages.map((p) => ({
    page_type: pageTypeRef(p.page_type),
    url: p.url,
    is_placeholder: bool(p.is_placeholder),
    screenshots: { desktop: pick(p.id, 'desktop'), mobile: pick(p.id, 'mobile') },
  }));
}

export async function similarStores(ctx: Ctx, storeId: number, limit = 6) {
  const rows = await ctx.db.all<StoreRow & { same_theme: number; shared_apps: number }>(
    `SELECT ss.same_theme, ss.shared_apps, ${STORE_COLS} ${STORE_FROM}
     JOIN store_similar ss ON ss.other_store_id = s.id
     WHERE ss.store_id = ? AND s.status = 'active'
     ORDER BY ss.score DESC, s.list_position LIMIT ?`,
    [storeId, limit],
  );
  const items = await hydrateStoreItems(ctx, rows);
  return items.map((store, i) => ({
    store,
    same_theme: bool(rows[i]?.same_theme),
    shared_apps: rows[i]?.shared_apps ?? 0,
  }));
}

/** This store plus up to 6 similar active stores, same order as similarStores. */
const relatedStoreIdsSql = `SELECT ? AS id
   UNION ALL
   SELECT id FROM (
     SELECT ss.other_store_id AS id FROM store_similar ss
     JOIN stores s ON s.id = ss.other_store_id AND s.status = 'active'
     WHERE ss.store_id = ?
     ORDER BY ss.score DESC, s.list_position
     LIMIT 6
   )`;

export async function getStoreDetail(ctx: Ctx, domain: string): Promise<StoreDetail> {
  try {
    const cached = await ctx.db.first<{ payload: string }>(
      'SELECT payload FROM store_page_cache WHERE domain = ?',
      [domain],
    );
    if (cached?.payload) return JSON.parse(cached.payload) as StoreDetail;
  } catch {
    // Table missing (migration not applied yet).
  }
  return computeStoreDetail(ctx, domain);
}

/** Live D1 path used to fill store_page_cache and as a fallback when the row is missing. */
export async function computeStoreDetail(ctx: Ctx, domain: string): Promise<StoreDetail> {
  const row = await findActiveStore(ctx, domain);
  if (!row) throw notFound(`Store '${domain}'`);
  const id = row.id;
  type HistoryRow = StoreThemeRow & {
    first_seen: string;
    last_seen: string;
    replaced_at: string | null;
  };
  type PageRow = { id: number; page_type: string; url: string | null; is_placeholder: number };
  type ShotRef = { id: number; page_id: number; device: string };
  type SimilarRow = StoreRow & { same_theme: number; shared_apps: number };
  const relatedParams = [id, id] as const;

  // One batch after the lookup: subject + similar apps/previews, apps, pages, shots, facts.
  const [
    topAppRows,
    previewRows,
    history,
    appRows,
    unresolved,
    seen,
    pixels,
    pageRows,
    shotRefs,
    similarRows,
    teardownRows,
    scanRows,
  ] = (await ctx.db.allBatch([
    {
      sql: `SELECT sa.store_id, ${APP_REF_COLS}
       FROM store_apps sa
       JOIN apps a ON a.id = sa.app_id AND a.status = 'active'
       LEFT JOIN app_categories ac ON ac.id = a.category_id
       LEFT JOIN app_stats st ON st.app_id = a.id
       WHERE sa.store_id IN (SELECT id FROM (${relatedStoreIdsSql})) AND sa.removed_at IS NULL
       ORDER BY sa.store_id, st.store_count DESC, a.slug`,
      params: relatedParams,
    },
    {
      sql: `SELECT ${THUMB_COLS} FROM screenshots sh
       WHERE sh.store_id IN (SELECT id FROM (${relatedStoreIdsSql})) AND sh.is_current = 1
         AND sh.page_type = 'home' AND sh.device = 'desktop'
       ORDER BY sh.is_placeholder, sh.id`,
      params: relatedParams,
    },
    {
      sql: `SELECT t.slug AS theme_slug, t.name AS theme_name, t.vendor AS theme_vendor,
         st.raw_name AS theme_raw_name, st.version AS theme_version, st.is_custom AS theme_is_custom,
         st.first_seen, st.last_seen, st.replaced_at
       FROM store_themes st LEFT JOIN themes t ON t.id = st.theme_id
       WHERE st.store_id = ? ORDER BY st.first_seen DESC, st.id DESC`,
      params: [id],
    },
    {
      sql: `SELECT a.id AS app_id, sa.confidence, sa.first_seen, sa.last_seen, st.store_count, ${APP_REF_COLS}
       FROM store_apps sa
       JOIN apps a ON a.id = sa.app_id AND a.status = 'active'
       LEFT JOIN app_categories ac ON ac.id = a.category_id
       LEFT JOIN app_stats st ON st.app_id = a.id
       WHERE sa.store_id = ? AND sa.removed_at IS NULL
       ORDER BY ac.position IS NULL, ac.position, st.store_count DESC, a.slug`,
      params: [id],
    },
    {
      sql: `SELECT detection_slug FROM store_unresolved_apps
       WHERE store_id = ? AND removed_at IS NULL ORDER BY detection_slug`,
      params: [id],
    },
    {
      sql: `SELECT DISTINCT app_id, section_type FROM sections
       WHERE store_id = ? AND is_current = 1 AND app_id IS NOT NULL ORDER BY section_type`,
      params: [id],
    },
    {
      sql: 'SELECT pixel FROM store_pixels WHERE store_id = ? AND removed_at IS NULL ORDER BY pixel',
      params: [id],
    },
    {
      sql: 'SELECT id, page_type, url, is_placeholder FROM pages WHERE store_id = ? ORDER BY id',
      params: [id],
    },
    {
      sql: `SELECT id, page_id, device FROM screenshots
       WHERE store_id = ? AND is_current = 1 ORDER BY is_placeholder, id`,
      params: [id],
    },
    {
      sql: `SELECT ss.same_theme, ss.shared_apps, ${STORE_COLS} ${STORE_FROM}
       JOIN store_similar ss ON ss.other_store_id = s.id
       WHERE ss.store_id = ? AND s.status = 'active'
       ORDER BY ss.score DESC, s.list_position LIMIT 6`,
      params: [id],
    },
    {
      sql: `SELECT slug, title FROM teardowns WHERE store_id = ? AND published_at IS NOT NULL
       ORDER BY published_at DESC LIMIT 1`,
      params: [id],
    },
    {
      sql: 'SELECT source, rules_version FROM scans WHERE store_id = ? ORDER BY ran_at DESC LIMIT 1',
      params: [id],
    },
  ])) as [
    (AppRefRow & { store_id: number })[],
    ThumbRow[],
    HistoryRow[],
    StoreAppRow[],
    { detection_slug: string }[],
    { app_id: number; section_type: string }[],
    { pixel: string }[],
    PageRow[],
    ShotRef[],
    SimilarRow[],
    { slug: string; title: string }[],
    { source: string; rules_version: string | null }[],
  ];

  const topApps = new Map<number, AppRef[]>();
  for (const r of topAppRows) {
    const list = topApps.get(r.store_id) ?? [];
    if (list.length < 5) list.push(appRef(r));
    topApps.set(r.store_id, list);
  }
  const previews = new Map<number, ReturnType<typeof toThumb>>();
  for (const r of previewRows)
    if (!previews.has(r.store_id)) previews.set(r.store_id, toThumb(r, ctx));

  const item = toStoreListItem(row, topApps.get(id) ?? [], previews.get(id) ?? null);
  const apps = assembleStoreApps(appRows, unresolved, seen);
  const details = await screenshotDetails(
    ctx,
    shotRefs.map((s) => s.id),
  );
  const pages = assembleStorePages(pageRows, shotRefs, details);
  const similar = similarRows.map((r) => ({
    store: toStoreListItem(r, topApps.get(r.id) ?? [], previews.get(r.id) ?? null),
    same_theme: bool(r.same_theme),
    shared_apps: r.shared_apps ?? 0,
  }));
  const teardown = teardownRows[0] ?? null;
  const scan = scanRows[0] ?? null;

  const devices = [
    ...new Set(
      pages.flatMap((p) =>
        (['desktop', 'mobile'] as const).filter((d) => p.screenshots[d] !== null),
      ),
    ),
  ];
  return {
    store: item,
    theme: {
      current: item.theme,
      history: history.map((h) => ({
        ...storeThemeInfo(h),
        first_seen: h.first_seen,
        last_seen: h.last_seen,
        replaced_at: h.replaced_at,
      })),
    },
    apps,
    pixels: pixels.map((p) => ({ slug: p.pixel, name: PIXELS[p.pixel] ?? p.pixel })),
    pages,
    devices,
    similar,
    teardown: teardown
      ? { slug: teardown.slug, title: teardown.title, href: hrefs.teardown(teardown.slug) }
      : null,
    detection: {
      first_seen: row.first_seen,
      last_seen: row.last_seen,
      source: scan?.source ?? ctx.data.scanSourceId,
      rules_version: scan?.rules_version ?? ctx.data.rulesVersion,
    },
  };
}

/** StoreRef by id list (keeps order), active stores only. */
export async function storeRefsByIds(ctx: Ctx, ids: readonly number[]): Promise<StoreRef[]> {
  if (ids.length === 0) return [];
  const rows = await ctx.db.all<{
    id: number;
    domain: string;
    name: string | null;
    is_curated: number;
  }>(
    `SELECT id, domain, name, is_curated FROM stores
     WHERE id IN (SELECT value FROM json_each(?)) AND status = 'active'`,
    [jsonIds(ids)],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [storeRef(r)] : [];
  });
}
