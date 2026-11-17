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
  jsonIds,
  price,
  ratio,
  sectionTypeRef,
  storeRef,
  themeRef,
  usageStat,
  type AppRefRow,
} from './refs.ts';
import { THUMB_COLS, sectionCards, toThumb, type ThumbRow } from './visual.ts';

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
  const rows = await ctx.db.all<ThumbRow & { theme_id: number }>(
    `SELECT sh.theme_id, ${THUMB_COLS}
     FROM screenshots sh JOIN stores st ON st.id = sh.store_id AND st.status = 'active'
     WHERE sh.theme_id IN (SELECT value FROM json_each(?)) AND sh.is_current = 1
       AND sh.page_type = 'home' AND sh.device = 'desktop'
     ORDER BY sh.theme_id, sh.is_placeholder, st.is_curated DESC, st.list_position`,
    [jsonIds(themeIds)],
  );
  for (const r of rows) {
    const list = out.get(r.theme_id) ?? [];
    if (list.length < perTheme) list.push(toThumb(r, ctx));
    out.set(r.theme_id, list);
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
  sort: 'usage' | 'name' | 'price';
  cursor?: string | undefined;
  limit: number;
}

function themeWhere(p: ListThemesParams, omit: ReadonlyArray<'vendor' | 'price_band'> = []) {
  const where = ["t.status = 'active'"];
  const params: SqlValue[] = [];
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
      where.push("t.slug IN (SELECT ref FROM search_index WHERE search_index MATCH ? AND kind = 'theme')");
      params.push(fts);
    }
  }
  return { sql: where.join(' AND '), params };
}

const THEME_ORDER = {
  usage: 'store_count DESC, t.name',
  name: 't.name',
  price: 't.price_cents IS NULL, t.price_cents, t.name',
} as const;

export async function listThemes(ctx: Ctx, p: ListThemesParams) {
  const offset = decodeOffset(p.cursor);
  const w = themeWhere(p);
  const vendorW = themeWhere(p, ['vendor']);
  const bandW = themeWhere(p, ['price_band']);
  const [rows, total, vendors, bands] = await Promise.all([
    ctx.db.all<ThemeRow>(
      `${THEME_SELECT} WHERE ${w.sql} ORDER BY ${THEME_ORDER[p.sort]} LIMIT ? OFFSET ?`,
      [...w.params, p.limit, offset],
    ),
    ctx.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM themes t WHERE ${w.sql}`, w.params),
    ctx.db.all<Facet>(
      `SELECT t.vendor_slug AS value, MIN(t.vendor) AS label, COUNT(*) AS count
       FROM themes t WHERE ${vendorW.sql} AND t.vendor_slug IS NOT NULL
       GROUP BY t.vendor_slug ORDER BY count DESC, label`,
      vendorW.params,
    ),
    ctx.db.all<{ value: PriceBand; count: number }>(
      `SELECT ${BAND_SQL} AS value, COUNT(*) AS count FROM themes t
       WHERE ${bandW.sql} AND t.price_cents IS NOT NULL GROUP BY value`,
      bandW.params,
    ),
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
export async function themeStores(
  ctx: Ctx,
  themeId: number,
  limit: number,
  cursor?: string,
): Promise<{ items: ThemeStoreRow[]; next_cursor: string | null; total: number }> {
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
      : ctx.db.all<{
          domain: string;
          name: string | null;
          is_curated: number;
          version: string | null;
          app_count: number;
          is_captured: number;
          has_plan: number;
          list_position: number;
        }>(
          `SELECT s.domain, s.name, s.is_curated, s.current_theme_version AS version, s.app_count,
             s.is_captured, s.list_position,
             EXISTS (SELECT 1 FROM screenshots sh WHERE sh.store_id = s.id AND sh.is_current = 1) AS has_plan
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
    total: total?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Similar themes (small catalogue: scored in memory)
// ---------------------------------------------------------------------------------------------
export async function similarThemes(
  ctx: Ctx,
  theme: ThemeRow,
  limit = 6,
): Promise<ThemeDetail['similar']> {
  const [all, usage] = await Promise.all([
    ctx.db.all<ThemeRow>(`${THEME_SELECT} WHERE t.status = 'active' AND t.id <> ?`, [theme.id]),
    ctx.db.all<{ theme_id: number; app_id: number }>(
      `SELECT theme_id, app_id FROM (
         SELECT theme_id, app_id,
           ROW_NUMBER() OVER (PARTITION BY theme_id ORDER BY store_count DESC, app_id) AS rn
         FROM theme_app_usage) WHERE rn <= 10`,
    ),
  ]);
  const topApps = new Map<number, Set<number>>();
  for (const u of usage) topApps.set(u.theme_id, (topApps.get(u.theme_id) ?? new Set()).add(u.app_id));
  const mine = topApps.get(theme.id) ?? new Set<number>();
  type Reason = ThemeDetail['similar'][number]['reasons'][number];
  const scored = all
    .map((t) => {
      const reasons: Reason[] = [];
      let score = 0;
      if (theme.vendor_slug && t.vendor_slug === theme.vendor_slug) {
        reasons.push('same-vendor');
        score += 3;
      }
      const a = theme.price_cents;
      const b = t.price_cents;
      if (a !== null && b !== null && (a === b || (a > 0 && b > 0 && Math.abs(a - b) <= 0.2 * Math.max(a, b)))) {
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
  const items = await hydrateThemes(
    ctx,
    scored.map((s) => s.row),
  );
  return items.map((theme, i) => ({
    theme,
    reasons: scored[i]?.reasons ?? [],
    score: scored[i]?.score ?? 0,
  }));
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------
export async function findTheme(ctx: Ctx, slug: string): Promise<ThemeRow | null> {
  return ctx.db.first<ThemeRow>(`${THEME_SELECT} WHERE t.slug = ? AND t.status = 'active'`, [slug]);
}

async function curatedShots(ctx: Ctx, themeId: number): Promise<CuratedStoreShots[]> {
  const rows = await ctx.db.all<
    ThumbRow & { domain: string; name: string | null; is_curated: number; version: string | null }
  >(
    `SELECT ${THUMB_COLS}, st.domain, st.name, st.is_curated, st.current_theme_version AS version
     FROM screenshots sh JOIN stores st ON st.id = sh.store_id AND st.status = 'active'
     WHERE sh.theme_id = ? AND sh.is_current = 1
     ORDER BY st.list_position, sh.id`,
    [themeId],
  );
  const byStore = new Map<string, CuratedStoreShots>();
  for (const r of rows) {
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
  return [...byStore.values()];
}

export async function getThemeDetail(
  ctx: Ctx,
  slug: string,
  opts: { storesLimit: number; sectionsLimit?: number },
): Promise<ThemeDetail> {
  const row = await findTheme(ctx, slug);
  if (!row) throw notFound(`Theme '${slug}'`);
  const [[item], versions, curated, stores, topApps, byType, samples, similar, presets, tags, comparisons] =
    await Promise.all([
      hydrateThemes(ctx, [row]),
      ctx.db.all<{ version: string | null; stores: number }>(
        `SELECT current_theme_version AS version, COUNT(*) AS stores FROM stores
         WHERE current_theme_id = ? AND status = 'active'
         GROUP BY current_theme_version ORDER BY stores DESC, version DESC`,
        [row.id],
      ),
      curatedShots(ctx, row.id),
      themeStores(ctx, row.id, opts.storesLimit),
      ctx.db.all<AppRefRow & { stores: number }>(
        `SELECT u.store_count AS stores, ${APP_REF_COLS}
         FROM theme_app_usage u
         JOIN apps a ON a.id = u.app_id AND a.status = 'active'
         LEFT JOIN app_categories ac ON ac.id = a.category_id
         WHERE u.theme_id = ? ORDER BY u.store_count DESC, a.slug LIMIT 12`,
        [row.id],
      ),
      ctx.db.all<{ section_type: string; count: number }>(
        `SELECT s.section_type, COUNT(*) AS count FROM sections s
         JOIN stores st ON st.id = s.store_id AND st.status = 'active'
         JOIN section_types ty ON ty.slug = s.section_type
         WHERE s.theme_id = ? AND s.is_current = 1
         GROUP BY s.section_type ORDER BY MIN(ty.position)`,
        [row.id],
      ),
      sectionCards(
        ctx,
        `s.id IN (SELECT id FROM (
           SELECT x.id, ROW_NUMBER() OVER (PARTITION BY x.section_type ORDER BY x.device, x.id) AS rn
           FROM sections x WHERE x.theme_id = ? AND x.is_current = 1
             AND x.section_type NOT IN ('announcement-bar', 'breadcrumbs')
         ) WHERE rn = 1)`,
        [row.id],
        `ORDER BY (SELECT position FROM section_types WHERE slug = s.section_type) LIMIT ${Math.max(0, Math.floor(opts.sectionsLimit ?? 12))}`,
      ),
      similarThemes(ctx, row),
      ctx.db.all<{ slug: string; name: string }>(
        'SELECT slug, name FROM theme_presets WHERE theme_id = ? ORDER BY name',
        [row.id],
      ),
      ctx.db.all<{ kind: 'style' | 'industry'; tag: string }>(
        'SELECT kind, tag FROM theme_tags WHERE theme_id = ? ORDER BY tag',
        [row.id],
      ),
      comparisonLinks(ctx, { kind: 'theme', entityId: row.id, limit: 12 }),
    ]);
  if (!item) throw notFound(`Theme '${slug}'`);
  return {
    theme: item,
    official_url: row.official_url,
    versions,
    curated_stores: curated,
    stores,
    top_apps: topApps.map((r) => ({
      app: appRef(r),
      stores: r.stores,
      share: ratio(r.stores, row.store_count),
    })),
    sections: {
      total: byType.reduce((sum, t) => sum + t.count, 0),
      by_type: byType.map((t) => ({ type: sectionTypeRef(t.section_type), count: t.count })),
      items: samples,
    },
    similar,
    presets,
    tags: {
      style: tags.filter((t) => t.kind === 'style').map((t) => t.tag),
      industry: tags.filter((t) => t.kind === 'industry').map((t) => t.tag),
    },
    comparisons,
  };
}
