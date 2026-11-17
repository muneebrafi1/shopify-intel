/** Theme queries: catalogue list, detail, stores on a theme, similar themes. */
import type { Ctx } from '../api/v1/context.ts';
import { notFound } from '../api/v1/errors.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import {
  decodeOffset,
  encodeCursor,
  decodeCursor,
  nextOffsetCursor,
} from '../api/v1/pagination.ts';
import type { Facet, ScreenshotThumb } from '../api/v1/schemas/common.ts';
import type {
  CuratedStoreShots,
  PriceBand,
  ThemeDetail,
  ThemeListItem,
  ThemeStoreRow,
} from '../api/v1/schemas/themes.ts';
import type { SqlValue } from '../db/types.ts';
import { activeLinks, buildCta } from './affiliate.ts';
import { comparisonLinks } from './comparisons.ts';
import { ftsPrefixQuery } from './fts.ts';
import {
  APP_REF_COLS,
  appRef,
  bool,
  groupBy,
  jsonIds,
  price,
  ratio,
  sectionTypeRef,
  storeRef,
  themeRef,
  usageStat,
  type AppRefRow,
} from './refs.ts';
import { THUMB_COLS, groupedSectionCards, toThumb, type ThumbRow } from './visual.ts';

export const THEME_SELECT = `SELECT t.id, t.slug, t.name, t.vendor, t.vendor_slug, t.theme_store_id,
  t.price_cents, t.price_label, t.marketplace, t.official_url,
  COALESCE(ts.store_count, 0) AS store_count, ts.denominator, ts.rank_overall,
  COALESCE(ts.curated_store_count, 0) AS curated_store_count,
  COALESCE(ts.section_count, 0) AS section_count
FROM themes t LEFT JOIN theme_stats ts ON ts.theme_id = t.id`;

export interface ThemeRow {
  id: number;
  slug: string;
  name: string;
  vendor: string | null;
  vendor_slug: string | null;
  theme_store_id: number | null;
  price_cents: number | null;
  price_label: string | null;
  marketplace: string | null;
  official_url: string | null;
  store_count: number;
  denominator: number | null;
  rank_overall: number | null;
  curated_store_count: number;
  section_count: number;
}

const BAND_SQL = `CASE
  WHEN t.price_cents IS NULL THEN NULL
  WHEN t.price_cents = 0 THEN 'free'
  WHEN t.price_cents < 30000 THEN 'under-300'
  WHEN t.price_cents < 40000 THEN '300-399'
  ELSE '400-plus' END`;

const BAND_LABELS: Record<PriceBand, string> = {
  free: 'Free',
  'under-300': 'Under $300',
  '300-399': '$300–$399',
  '400-plus': '$400 and up',
};

/** Up to `perTheme` home/desktop shots captured on each theme (curated stores first). */
async function themePreviews(
  ctx: Ctx,
  themeIds: readonly number[],
  perTheme: number,
): Promise<Map<number, ScreenshotThumb[]>> {
  const out = new Map<number, ScreenshotThumb[]>();
  if (themeIds.length === 0) return out;
  // Desktop home captures first (one per store, up to perTheme). When a theme has fewer stores
  // than that, the first store's mobile home capture is appended so cards can pair devices.
  const rows = await ctx.db.all<ThumbRow & { theme_id: number }>(
    `SELECT sh.theme_id, ${THUMB_COLS}
     FROM screenshots sh JOIN stores st ON st.id = sh.store_id AND st.status = 'active'
     WHERE sh.theme_id IN (SELECT value FROM json_each(?)) AND sh.is_current = 1
       AND sh.page_type = 'home' AND sh.device IN ('desktop', 'mobile')
     ORDER BY sh.theme_id, sh.device = 'mobile', sh.is_placeholder, st.is_curated DESC, st.list_position`,
    [jsonIds(themeIds)],
  );
  const firstMobile = new Map<number, ScreenshotThumb>();
  for (const r of rows) {
    if (r.device === 'mobile') {
      if (!firstMobile.has(r.theme_id)) firstMobile.set(r.theme_id, toThumb(r, ctx));
      continue;
    }
    const list = out.get(r.theme_id) ?? [];
    if (list.length < perTheme) list.push(toThumb(r, ctx));
    out.set(r.theme_id, list);
  }
  for (const [themeId, mobile] of firstMobile) {
    const list = out.get(themeId) ?? [];
    if (list.length < perTheme) list.push(mobile);
    out.set(themeId, list);
  }
  return out;
}

export async function hydrateThemes(ctx: Ctx, rows: ThemeRow[]): Promise<ThemeListItem[]> {
  const ids = rows.map((r) => r.id);
  const [previews, links] = await Promise.all([
    themePreviews(ctx, ids, 3),
    activeLinks(ctx, 'theme', ids),
  ]);
  return rows.map((r) => ({
    ...themeRef(r),
    vendor_info:
      r.vendor && r.vendor_slug
        ? { name: r.vendor, slug: r.vendor_slug, href: hrefs.themeVendor(r.vendor_slug) }
        : null,
    price: price(r.price_cents, r.price_label),
    marketplace: r.marketplace,
    theme_store_id: r.theme_store_id,
    usage: usageStat(ctx, r.store_count, r.denominator, r.rank_overall),
    curated_store_count: r.curated_store_count,
    previews: previews.get(r.id) ?? [],
    cta: buildCta({
      linkId: links.get(r.id),
      officialUrl: r.official_url,
      label: r.marketplace ? `View on ${r.marketplace}` : `Visit ${r.vendor ?? 'vendor'} site`,
    }),
  }));
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------
export interface ListThemesParams {
  price?: 'free' | 'paid' | undefined;
  price_band?: PriceBand | undefined;
  vendor?: string | undefined;
  q?: string | undefined;
  /** Only these themes. */
  slugs?: readonly string[] | undefined;
  sort: 'usage' | 'name' | 'price';
  cursor?: string | undefined;
  limit: number;
  /** false: skip the vendor and price-band facets (returned empty). */
  facets?: boolean | undefined;
}

function themeWhere(p: ListThemesParams, omit: ReadonlyArray<'vendor' | 'price_band'> = []) {
  const where = ["t.status = 'active'"];
  const params: SqlValue[] = [];
  if (p.slugs) {
    where.push('t.slug IN (SELECT value FROM json_each(?))');
    params.push(jsonIds(p.slugs));
  }
  if (p.price === 'free') where.push('t.price_cents = 0');
  if (p.price === 'paid') where.push('t.price_cents > 0');
  if (p.price_band && !omit.includes('price_band')) {
    where.push(`${BAND_SQL} = ?`);
    params.push(p.price_band);
  }
  if (p.vendor && !omit.includes('vendor')) {
    where.push('t.vendor_slug = ?');
    params.push(p.vendor);
  }
  if (p.q?.trim()) {
    const fts = ftsPrefixQuery(p.q);
    if (!fts) where.push('0');
    else {
      where.push(
        "t.slug IN (SELECT ref FROM search_index WHERE search_index MATCH ? AND kind = 'theme')",
      );
      params.push(fts);
    }
  }
  return { sql: where.join(' AND '), params };
}

// Ties in usage share a rank (theme_stats); their display order is the name, then the slug.
const THEME_ORDER = {
  usage: 'store_count DESC, t.name COLLATE NOCASE, t.slug',
  name: 't.name',
  price: 't.price_cents IS NULL, t.price_cents, t.name',
} as const;

export async function listThemes(ctx: Ctx, p: ListThemesParams) {
  const offset = decodeOffset(p.cursor);
  const w = themeWhere(p);
  const vendorW = themeWhere(p, ['vendor']);
  const bandW = themeWhere(p, ['price_band']);
  const withFacets = p.facets !== false;
  const [rows, total, vendors, bands] = await Promise.all([
    ctx.db.all<ThemeRow>(
      `${THEME_SELECT} WHERE ${w.sql} ORDER BY ${THEME_ORDER[p.sort]} LIMIT ? OFFSET ?`,
      [...w.params, p.limit, offset],
    ),
    ctx.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM themes t WHERE ${w.sql}`, w.params),
    withFacets
      ? ctx.db.all<Facet>(
          `SELECT t.vendor_slug AS value, MIN(t.vendor) AS label, COUNT(*) AS count
           FROM themes t WHERE ${vendorW.sql} AND t.vendor_slug IS NOT NULL
           GROUP BY t.vendor_slug ORDER BY count DESC, label`,
          vendorW.params,
        )
      : Promise.resolve([]),
    withFacets
      ? ctx.db.all<{ value: PriceBand; count: number }>(
          `SELECT ${BAND_SQL} AS value, COUNT(*) AS count FROM themes t
           WHERE ${bandW.sql} AND t.price_cents IS NOT NULL GROUP BY value`,
          bandW.params,
        )
      : Promise.resolve([]),
  ]);
  const n = total?.n ?? 0;
  const bandOrder = Object.keys(BAND_LABELS) as PriceBand[];
  return {
    items: await hydrateThemes(ctx, rows),
    facets: {
      vendors: vendors,
      price_bands: bandOrder.flatMap((b) => {
        const hit = bands.find((x) => x.value === b);
        return hit ? [{ value: b, label: BAND_LABELS[b], count: hit.count }] : [];
      }),
    },
    pagination: { limit: p.limit, next_cursor: nextOffsetCursor(offset, p.limit, n), total: n },
  };
}

// ---------------------------------------------------------------------------------------------
// Stores on a theme (keyset on list_position)
// ---------------------------------------------------------------------------------------------
type ThemeStoreDbRow = {
  domain: string;
  name: string | null;
  is_curated: number;
  version: string | null;
  app_count: number;
  is_captured: number;
  has_plan: number;
  list_position: number;
};

const THEME_STORE_COLS = `s.domain, s.name, s.is_curated, s.current_theme_version AS version, s.app_count,
  s.is_captured, s.list_position,
  EXISTS (SELECT 1 FROM screenshots sh WHERE sh.store_id = s.id AND sh.is_current = 1) AS has_plan`;

type ThemeStorePage = { items: ThemeStoreRow[]; next_cursor: string | null; total: number };

/** A page of store rows (`rows` holds up to limit + 1, the extra one only signals more). */
function themeStorePage(rows: ThemeStoreDbRow[], limit: number, total: number): ThemeStorePage {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      store: storeRef(r),
      version: r.version,
      app_count: r.app_count,
      is_captured: bool(r.is_captured),
      has_capture_plan: bool(r.has_plan),
    })),
    next_cursor: rows.length > limit && last ? encodeCursor([last.list_position]) : null,
    total,
  };
}

export async function themeStores(
  ctx: Ctx,
  themeId: number,
  limit: number,
  cursor?: string,
): Promise<ThemeStorePage> {
  const params: SqlValue[] = [themeId];
  let seek = '';
  if (cursor) {
    const [pos] = decodeCursor(cursor, 1);
    seek = 'AND s.list_position > ?';
    params.push(pos ?? 0);
  }
  const [rows, total] = await Promise.all([
    limit === 0
      ? Promise.resolve([])
      : ctx.db.all<ThemeStoreDbRow>(
          `SELECT ${THEME_STORE_COLS}
           FROM stores s
           WHERE s.current_theme_id = ? AND s.status = 'active' ${seek}
           ORDER BY s.list_position LIMIT ?`,
          [...params, limit + 1],
        ),
    ctx.db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM stores WHERE current_theme_id = ? AND status = 'active'",
      [themeId],
    ),
  ]);
  return themeStorePage(rows, limit, total?.n ?? 0);
}

/** The first page of `themeStores` for each theme, with its total, in one windowed query. */
async function themeStoresFirstPages(
  ctx: Ctx,
  themeIds: readonly number[],
  limit: number,
): Promise<Map<number, ThemeStorePage>> {
  const rows = await ctx.db.all<ThemeStoreDbRow & { g_theme: number; g_total: number }>(
    `SELECT * FROM (
       SELECT s.current_theme_id AS g_theme, ${THEME_STORE_COLS},
         ROW_NUMBER() OVER (PARTITION BY s.current_theme_id ORDER BY s.list_position) AS g_rn,
         COUNT(*) OVER (PARTITION BY s.current_theme_id) AS g_total
       FROM stores s
       WHERE s.current_theme_id IN (SELECT value FROM json_each(?)) AND s.status = 'active'
     ) WHERE g_rn <= ? ORDER BY g_theme, g_rn`,
    [jsonIds(themeIds), limit + 1],
  );
  const byTheme = groupBy(rows, (r) => r.g_theme);
  return new Map(
    themeIds.map((id) => {
      const mine = byTheme.get(id) ?? [];
      return [id, themeStorePage(mine, limit, mine[0]?.g_total ?? 0)];
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Similar themes (small catalogue: scored in memory)
// ---------------------------------------------------------------------------------------------
type SimilarReason = ThemeDetail['similar'][number]['reasons'][number];
type ScoredTheme = { row: ThemeRow; reasons: SimilarReason[]; score: number };

/** The two catalogue-wide inputs of the similarity score (shared by every theme scored). */
async function similarityInputs(ctx: Ctx) {
  const [all, usage] = await Promise.all([
    ctx.db.all<ThemeRow>(`${THEME_SELECT} WHERE t.status = 'active'`),
    ctx.db.all<{ theme_id: number; app_id: number }>(
      `SELECT theme_id, app_id FROM (
         SELECT theme_id, app_id,
           ROW_NUMBER() OVER (PARTITION BY theme_id ORDER BY store_count DESC, app_id) AS rn
         FROM theme_app_usage) WHERE rn <= 10`,
    ),
  ]);
  const topApps = new Map<number, Set<number>>();
  for (const u of usage)
    topApps.set(u.theme_id, (topApps.get(u.theme_id) ?? new Set()).add(u.app_id));
  return { all, topApps };
}

/** Other themes scored against `theme`: same vendor, similar price, shared top apps. */
function scoreSimilar(
  theme: ThemeRow,
  { all, topApps }: Awaited<ReturnType<typeof similarityInputs>>,
  limit: number,
): ScoredTheme[] {
  const mine = topApps.get(theme.id) ?? new Set<number>();
  return all
    .filter((t) => t.id !== theme.id)
    .map((t) => {
      const reasons: SimilarReason[] = [];
      let score = 0;
      if (theme.vendor_slug && t.vendor_slug === theme.vendor_slug) {
        reasons.push('same-vendor');
        score += 3;
      }
      const a = theme.price_cents;
      const b = t.price_cents;
      if (
        a !== null &&
        b !== null &&
        (a === b || (a > 0 && b > 0 && Math.abs(a - b) <= 0.2 * Math.max(a, b)))
      ) {
        reasons.push('similar-price');
        score += 2;
      }
      const overlap = [...(topApps.get(t.id) ?? [])].filter((x) => mine.has(x)).length;
      if (overlap >= 3) {
        reasons.push('shared-apps');
        score += overlap * 0.25;
      }
      return { row: t, reasons, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || y.row.store_count - x.row.store_count)
    .slice(0, limit);
}

const withItems = (scored: ScoredTheme[], items: ThemeListItem[]): ThemeDetail['similar'] =>
  items.map((theme, i) => ({
    theme,
    reasons: scored[i]?.reasons ?? [],
    score: scored[i]?.score ?? 0,
  }));

export async function similarThemes(
  ctx: Ctx,
  theme: ThemeRow,
  limit = 6,
): Promise<ThemeDetail['similar']> {
  const scored = scoreSimilar(theme, await similarityInputs(ctx), limit);
  const items = await hydrateThemes(
    ctx,
    scored.map((s) => s.row),
  );
  return withItems(scored, items);
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------
export async function findTheme(ctx: Ctx, slug: string): Promise<ThemeRow | null> {
  return ctx.db.first<ThemeRow>(`${THEME_SELECT} WHERE t.slug = ? AND t.status = 'active'`, [slug]);
}

/** Curated stores with their current shots on each theme (one query for all themes). */
async function curatedShots(
  ctx: Ctx,
  themeIds: readonly number[],
): Promise<Map<number, CuratedStoreShots[]>> {
  const rows = await ctx.db.all<
    ThumbRow & {
      g_theme: number;
      domain: string;
      name: string | null;
      is_curated: number;
      version: string | null;
    }
  >(
    `SELECT sh.theme_id AS g_theme, ${THUMB_COLS}, st.domain, st.name, st.is_curated,
       st.current_theme_version AS version
     FROM screenshots sh JOIN stores st ON st.id = sh.store_id AND st.status = 'active'
     WHERE sh.theme_id IN (SELECT value FROM json_each(?)) AND sh.is_current = 1
     ORDER BY sh.theme_id, st.list_position, sh.id`,
    [jsonIds(themeIds)],
  );
  const out = new Map<number, Map<string, CuratedStoreShots>>();
  for (const r of rows) {
    const byStore = out.get(r.g_theme) ?? new Map<string, CuratedStoreShots>();
    out.set(r.g_theme, byStore);
    let entry = byStore.get(r.domain);
    if (!entry) {
      entry = { store: storeRef(r), version: r.version, pages: [] };
      byStore.set(r.domain, entry);
    }
    const thumb = toThumb(r, ctx);
    let page = entry.pages.find((p) => p.page_type === thumb.page_type);
    if (!page) {
      page = { page_type: thumb.page_type, desktop: null, mobile: null };
      entry.pages.push(page);
    }
    page[thumb.device] ??= thumb;
  }
  return new Map([...out].map(([id, byStore]) => [id, [...byStore.values()]]));
}

export async function getThemeDetail(
  ctx: Ctx,
  slug: string,
  opts: { storesLimit: number; sectionsLimit?: number },
): Promise<ThemeDetail> {
  const row = await findTheme(ctx, slug);
  if (!row) throw notFound(`Theme '${slug}'`);
  const [detail] = await themeDetails(ctx, [row], opts);
  if (!detail) throw notFound(`Theme '${slug}'`);
  return detail;
}

const byTheme = <T extends { g_theme: number }>(rows: readonly T[]) =>
  groupBy(rows, (r) => r.g_theme);

/**
 * Theme details for several themes at once (the compare page shows two), with the same number
 * of queries as one: every per-theme list is one query over all of them.
 */
export async function themeDetails(
  ctx: Ctx,
  rows: readonly ThemeRow[],
  opts: { storesLimit: number; sectionsLimit?: number },
): Promise<ThemeDetail[]> {
  if (rows.length === 0) return [];
  const themeIds = rows.map((r) => r.id);
  const ids = jsonIds(themeIds);
  const inThemes = 'IN (SELECT value FROM json_each(?))';
  const [
    versions,
    curated,
    stores,
    topApps,
    byType,
    samples,
    similarity,
    presets,
    tags,
    comparisons,
  ] = await Promise.all([
    ctx.db.all<{ g_theme: number; version: string | null; stores: number }>(
      `SELECT current_theme_id AS g_theme, current_theme_version AS version, COUNT(*) AS stores
         FROM stores WHERE current_theme_id ${inThemes} AND status = 'active'
         GROUP BY current_theme_id, current_theme_version
         ORDER BY current_theme_id, stores DESC, version DESC`,
      [ids],
    ),
    curatedShots(ctx, themeIds),
    themeStoresFirstPages(ctx, themeIds, opts.storesLimit),
    ctx.db.all<AppRefRow & { g_theme: number; stores: number }>(
      `SELECT * FROM (
         SELECT u.theme_id AS g_theme, u.store_count AS stores, ${APP_REF_COLS},
           ROW_NUMBER() OVER (PARTITION BY u.theme_id ORDER BY u.store_count DESC, a.slug) AS g_rn
         FROM theme_app_usage u
         JOIN apps a ON a.id = u.app_id AND a.status = 'active'
         LEFT JOIN app_categories ac ON ac.id = a.category_id
         WHERE u.theme_id ${inThemes}
       ) WHERE g_rn <= 12 ORDER BY g_theme, g_rn`,
      [ids],
    ),
    ctx.db.all<{ g_theme: number; section_type: string; count: number }>(
      `SELECT s.theme_id AS g_theme, s.section_type, COUNT(*) AS count FROM sections s
         JOIN stores st ON st.id = s.store_id AND st.status = 'active'
         JOIN section_types ty ON ty.slug = s.section_type
         WHERE s.theme_id ${inThemes} AND s.is_current = 1
         GROUP BY s.theme_id, s.section_type ORDER BY s.theme_id, MIN(ty.position)`,
      [ids],
    ),
    // One sample per section type (desktop first), in taxonomy order, per theme.
    groupedSectionCards(ctx, {
      group: 's.theme_id',
      where: `s.id IN (SELECT id FROM (
           SELECT x.id, ROW_NUMBER() OVER (
             PARTITION BY x.theme_id, x.section_type ORDER BY x.device, x.id) AS rn
           FROM sections x WHERE x.theme_id ${inThemes} AND x.is_current = 1
             AND x.section_type NOT IN ('announcement-bar', 'breadcrumbs')
         ) WHERE rn = 1)`,
      params: [ids],
      order: '(SELECT position FROM section_types WHERE slug = s.section_type), s.id',
      per: Math.max(0, Math.floor(opts.sectionsLimit ?? 12)),
    }),
    similarityInputs(ctx),
    ctx.db.all<{ g_theme: number; slug: string; name: string }>(
      `SELECT theme_id AS g_theme, slug, name FROM theme_presets WHERE theme_id ${inThemes}
         ORDER BY theme_id, name`,
      [ids],
    ),
    ctx.db.all<{ g_theme: number; kind: 'style' | 'industry'; tag: string }>(
      `SELECT theme_id AS g_theme, kind, tag FROM theme_tags WHERE theme_id ${inThemes}
         ORDER BY theme_id, tag`,
      [ids],
    ),
    comparisonLinks(ctx, { kind: 'theme', entityIds: themeIds, limit: 500 }),
  ]);

  // Second round: list items (previews, CTA links) for the themes and every similar theme.
  const similar = rows.map((row) => scoreSimilar(row, similarity, 6));
  const listed = [...rows, ...similar.flat().map((s) => s.row)];
  const items = await hydrateThemes(ctx, listed);
  const itemById = new Map(listed.map((r, i) => [r.id, items[i]]));

  const versionsOf = byTheme(versions);
  const topAppsOf = byTheme(topApps);
  const byTypeOf = byTheme(byType);
  const presetsOf = byTheme(presets);
  const tagsOf = byTheme(tags);
  return rows.flatMap((row, i): ThemeDetail[] => {
    const item = itemById.get(row.id);
    if (!item) return [];
    const scored = similar[i] ?? [];
    const types = byTypeOf.get(row.id) ?? [];
    const themeTags = tagsOf.get(row.id) ?? [];
    return [
      {
        theme: item,
        official_url: row.official_url,
        versions: (versionsOf.get(row.id) ?? []).map((v) => ({
          version: v.version,
          stores: v.stores,
        })),
        curated_stores: curated.get(row.id) ?? [],
        stores: stores.get(row.id) ?? themeStorePage([], opts.storesLimit, 0),
        top_apps: (topAppsOf.get(row.id) ?? []).map((r) => ({
          app: appRef(r),
          stores: r.stores,
          share: ratio(r.stores, row.store_count),
        })),
        sections: {
          total: types.reduce((sum, t) => sum + t.count, 0),
          by_type: types.map((t) => ({ type: sectionTypeRef(t.section_type), count: t.count })),
          items: samples.get(row.id)?.cards ?? [],
        },
        similar: withItems(
          scored,
          scored.flatMap((x) => itemById.get(x.row.id) ?? []),
        ),
        presets: (presetsOf.get(row.id) ?? []).map((p) => ({ slug: p.slug, name: p.name })),
        tags: {
          style: themeTags.filter((t) => t.kind === 'style').map((t) => t.tag),
          industry: themeTags.filter((t) => t.kind === 'industry').map((t) => t.tag),
        },
        comparisons: comparisons
          .filter((l) => l.a.slug === row.slug || l.b.slug === row.slug)
          .slice(0, 12),
      },
    ];
  });
}

/** `findTheme` for several slugs in one query, keyed by slug. */
export async function findThemes(
  ctx: Ctx,
  slugs: readonly string[],
): Promise<Map<string, ThemeRow>> {
  const rows = await ctx.db.all<ThemeRow>(
    `${THEME_SELECT} WHERE t.slug IN (SELECT value FROM json_each(?)) AND t.status = 'active'`,
    [jsonIds([...new Set(slugs)])],
  );
  return new Map(rows.map((r) => [r.slug, r]));
}
