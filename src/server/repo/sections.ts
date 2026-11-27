/** Sections library: filtered list with facets, section types, section and screenshot detail. */
import { SECTION_GROUPS, SECTION_TYPES, type SectionType } from '../../lib/taxonomy.ts';
import type { Ctx } from '../api/v1/context.ts';
import { notFound } from '../api/v1/errors.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import { decodeCursor, encodeCursor } from '../api/v1/pagination.ts';
import type { Facet, ScreenshotDetail, SectionCard } from '../api/v1/schemas/common.ts';
import type {
  ListSectionsOutput,
  SectionDetail,
  SectionTypeInfo,
} from '../api/v1/schemas/sections.ts';
import type { SqlValue } from '../db/types.ts';
import { normalizeDomain } from '../lib/slug.ts';
import { categoriesForSection } from './apps.ts';
import { resolveAppId } from './stores.ts';
import { jsonIds, pageTypeRef, sectionTypeRef } from './refs.ts';
import {
  rankedCardsSql,
  screenshotDetails,
  sectionCards,
  toSectionCard,
  type RankedCardCols,
  type SectionCardRow,
} from './visual.ts';

export interface SectionFilters {
  type?: SectionType | undefined;
  group?: string | undefined;
  page_type?: string | undefined;
  device?: string | undefined;
  themeId?: number | null | undefined;
  appId?: number | null | undefined;
  storeId?: number | null | undefined;
}
type Key = keyof SectionFilters;

/** WHERE on `sections s` joined to `stores st` (active). Null ids mean "unknown → no rows". */
function sectionWhere(f: SectionFilters, omit: readonly Key[] = []) {
  const where = ['s.is_current = 1'];
  const params: SqlValue[] = [];
  const add = (key: Key, sql: string, value: SqlValue | undefined | null) => {
    if (f[key] === undefined || omit.includes(key)) return;
    if (value === null) {
      where.push('0');
      return;
    }
    where.push(sql);
    params.push(value ?? null);
  };
  add('type', 's.section_type = ?', f.type);
  add('group', 's.section_type IN (SELECT slug FROM section_types WHERE group_slug = ?)', f.group);
  add('page_type', 's.page_type = ?', f.page_type);
  add('device', 's.device = ?', f.device);
  add('themeId', 's.theme_id = ?', f.themeId);
  add('appId', 's.app_id = ?', f.appId);
  add('storeId', 's.store_id = ?', f.storeId);
  return { sql: where.join(' AND '), params };
}

const FROM = "FROM sections s JOIN stores st ON st.id = s.store_id AND st.status = 'active'";

type Count = { value: string; count: number };

function shapeFacets(
  types: Count[],
  groups: Count[],
  pages: Count[],
  devices: Count[],
  themes: Facet[],
  apps: Facet[],
): ListSectionsOutput['facets'] {
  const ordered = <T extends { slug: string; name: string }>(vocab: readonly T[], rows: Count[]) =>
    vocab.flatMap((v): Facet[] => {
      const hit = rows.find((r) => r.value === v.slug);
      return hit ? [{ value: v.slug, label: v.name, count: hit.count }] : [];
    });
  return {
    types: ordered(SECTION_TYPES, types),
    groups: ordered(SECTION_GROUPS, groups),
    page_types: pages.map((p) => ({
      value: p.value,
      label: pageTypeRef(p.value).name,
      count: p.count,
    })),
    devices: ['desktop', 'mobile'].flatMap((d) => {
      const hit = devices.find((x) => x.value === d);
      return hit
        ? [{ value: d, label: d === 'desktop' ? 'Desktop' : 'Mobile', count: hit.count }]
        : [];
    }),
    themes,
    apps,
  };
}

/** Precomputed counts cover the unfiltered library and a single type filter. */
function facetScope(f: SectionFilters): string | null {
  if (
    f.group !== undefined ||
    f.page_type !== undefined ||
    f.device !== undefined ||
    f.themeId !== undefined ||
    f.appId !== undefined ||
    f.storeId !== undefined
  )
    return null;
  return f.type ?? '';
}

async function precomputedFacets(
  ctx: Ctx,
  scope: string,
): Promise<ListSectionsOutput['facets'] | null> {
  type Row = { facet: string; value: string; label: string; count: number };
  let rows: Row[];
  try {
    rows = await ctx.db.all<Row>(
      `SELECT facet, value, label, count FROM section_facet_counts WHERE scope = ?`,
      [scope],
    );
  } catch {
    return null;
  }
  if (rows.length === 0) return null;
  const of = (facet: string) => rows.filter((r) => r.facet === facet);
  return shapeFacets(
    of('type').map((r) => ({ value: r.value, count: r.count })),
    of('group').map((r) => ({ value: r.value, count: r.count })),
    of('page_type').map((r) => ({ value: r.value, count: r.count })),
    of('device').map((r) => ({ value: r.value, count: r.count })),
    of('theme').map((r) => ({ value: r.value, label: r.label, count: r.count })),
    of('app').map((r) => ({ value: r.value, label: r.label, count: r.count })),
  );
}

async function sectionFacets(ctx: Ctx, f: SectionFilters): Promise<ListSectionsOutput['facets']> {
  const scope = facetScope(f);
  if (scope !== null) {
    const pre = await precomputedFacets(ctx, scope);
    if (pre) return pre;
  }
  const runSql = (omit: Key[], sql: (where: string) => string) => {
    const w = sectionWhere(f, omit);
    return { sql: sql(w.sql), params: w.params };
  };
  const [types, groups, pages, devices, themes, apps] = (await ctx.db.allBatch([
    runSql(
      ['type', 'group'],
      (w) =>
        `SELECT s.section_type AS value, COUNT(*) AS count ${FROM} WHERE ${w} GROUP BY s.section_type`,
    ),
    runSql(
      ['type', 'group'],
      (w) => `SELECT ty.group_slug AS value, COUNT(*) AS count ${FROM}
        JOIN section_types ty ON ty.slug = s.section_type WHERE ${w} GROUP BY ty.group_slug`,
    ),
    runSql(
      ['page_type'],
      (w) =>
        `SELECT s.page_type AS value, COUNT(*) AS count ${FROM} WHERE ${w} GROUP BY s.page_type`,
    ),
    runSql(
      ['device'],
      (w) => `SELECT s.device AS value, COUNT(*) AS count ${FROM} WHERE ${w} GROUP BY s.device`,
    ),
    runSql(
      ['themeId'],
      (w) => `SELECT t.slug AS value, t.name AS label, COUNT(*) AS count ${FROM}
        JOIN themes t ON t.id = s.theme_id WHERE ${w}
        GROUP BY t.id ORDER BY count DESC, t.name LIMIT 30`,
    ),
    runSql(
      ['appId'],
      (w) => `SELECT a.slug AS value, a.short_name AS label, COUNT(*) AS count ${FROM}
        JOIN apps a ON a.id = s.app_id WHERE ${w}
        GROUP BY a.id ORDER BY count DESC, a.short_name LIMIT 30`,
    ),
  ])) as [Count[], Count[], Count[], Count[], Facet[], Facet[]];
  return shapeFacets(types, groups, pages, devices, themes, apps);
}

/**
 * "Mixed" library order: a stable shuffle (Knuth multiplicative hash of the id) so browsing
 * interleaves stores and pages instead of walking one page at a time. Same order every request;
 * keyset-paginated on (mix, id).
 */
const MIX_SQL = '((s.id * 2654435761) % 4294967296)';
const mixOf = (id: number) => Number((BigInt(id) * 2654435761n) % 4294967296n);

/**
 * Library ("mixed") order leads with what browses well: visually rich sections before thin
 * utility strips, desktop before mobile, then a stable shuffle so stores interleave.
 */
const THIN_TYPES = [
  'announcement-bar',
  'breadcrumbs',
  'header',
  'filters',
  'shipping-bar',
  'trust-badges',
  'logo-list',
];
const TIER_SQL = `((CASE WHEN s.section_type IN (${THIN_TYPES.map((t) => `'${t}'`).join(', ')}) THEN 2 ELSE 0 END) + (CASE WHEN s.device = 'mobile' THEN 1 ELSE 0 END))`;
const tierOf = (type: string, device: string) =>
  (THIN_TYPES.includes(type) ? 2 : 0) + (device === 'mobile' ? 1 : 0);

export interface ListSectionsParams {
  type?: SectionType | undefined;
  group?: string | undefined;
  page_type?: string | undefined;
  device?: string | undefined;
  theme?: string | undefined;
  app?: string | undefined;
  store?: string | undefined;
  sort?: 'id' | 'mixed' | undefined;
  cursor?: string | undefined;
  limit: number;
  /** false: items and pagination only (no facet counts, no section_type info). */
  facets?: boolean | undefined;
}

/** ORDER BY for each list sort (aliases s, st); every key ends on the unique id. */
const SECTION_ORDER = {
  id: 's.id',
  mixed: `${TIER_SQL}, ${MIX_SQL}, s.id`,
} as const;

/** Facets left out on request (`facets: false`): the same shape, nothing counted. */
const noFacets = (): ListSectionsOutput['facets'] => ({
  types: [],
  groups: [],
  page_types: [],
  devices: [],
  themes: [],
  apps: [],
});

export async function listSections(ctx: Ctx, p: ListSectionsParams) {
  const f: SectionFilters = {
    type: p.type,
    group: p.group,
    page_type: p.page_type,
    device: p.device,
  };
  if (p.theme) {
    const t = await ctx.db.first<{ id: number }>(
      "SELECT id FROM themes WHERE slug = ? AND status = 'active'",
      [p.theme],
    );
    f.themeId = t?.id ?? null;
  }
  if (p.app) f.appId = await resolveAppId(ctx, p.app);
  if (p.store) {
    const domain = normalizeDomain(p.store);
    const s = domain
      ? await ctx.db.first<{ id: number }>(
          "SELECT id FROM stores WHERE domain = ? AND status = 'active'",
          [domain],
        )
      : null;
    f.storeId = s?.id ?? null;
  }
  const w = sectionWhere(f);
  const mixed = p.sort === 'mixed';
  const seek = p.cursor ? decodeCursor(p.cursor, mixed ? 3 : 1) : null;
  const seekSql = seek
    ? mixed
      ? ` AND (${TIER_SQL}, ${MIX_SQL}, s.id) > (?, ?, ?)`
      : ' AND s.id > ?'
    : '';
  const withFacets = p.facets !== false;
  const [items, total, facets, typeInfo] = await Promise.all([
    sectionCards(
      ctx,
      `${w.sql}${seekSql}`,
      seek ? [...w.params, ...seek] : w.params,
      `ORDER BY ${SECTION_ORDER[mixed ? 'mixed' : 'id']} LIMIT ${p.limit + 1}`,
    ),
    ctx.db.first<{ n: number }>(`SELECT COUNT(*) AS n ${FROM} WHERE ${w.sql}`, w.params),
    withFacets ? sectionFacets(ctx, f) : Promise.resolve(noFacets()),
    p.type && withFacets ? sectionTypeInfos(ctx, [p.type]) : Promise.resolve([]),
  ]);
  const page = items.slice(0, p.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    facets,
    section_type: typeInfo[0] ?? null,
    pagination: {
      limit: p.limit,
      next_cursor:
        items.length > p.limit && last
          ? encodeCursor(
              mixed ? [tierOf(last.type.slug, last.device), mixOf(last.id), last.id] : [last.id],
            )
          : null,
      total: total?.n ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Sections of several apps at once
// ---------------------------------------------------------------------------------------------
export interface ListSectionsByAppsParams {
  apps: readonly string[];
  type?: SectionType | undefined;
  group?: string | undefined;
  page_type?: string | undefined;
  device?: string | undefined;
  sort?: 'id' | 'mixed' | undefined;
  per_app: number;
}

/** App id of the slug or alias `j.value`, as `resolveAppId` resolves it (slug first). */
const APP_ID_OF_SLUG = `COALESCE(
  (SELECT id FROM apps WHERE slug = j.value AND status = 'active'),
  (SELECT app_id FROM app_aliases WHERE slug = j.value))`;

/**
 * For each app, the first `per_app` sections and the total: the same items, order and total as
 * `listSections({ app, ...filters, sort, limit: per_app })`, for many apps in ONE statement (the
 * slugs resolve in a CTE, a window ranks each app's sections). Apps come back in request order;
 * unknown slugs are left out, known apps without a matching section have total 0.
 */
export async function listSectionsByApps(ctx: Ctx, p: ListSectionsByAppsParams) {
  const slugs = [...new Set(p.apps)];
  const w = sectionWhere({
    type: p.type,
    group: p.group,
    page_type: p.page_type,
    device: p.device,
  });
  const ranked = rankedCardsSql(
    's.app_id',
    `${w.sql} AND s.app_id IN (SELECT app_id FROM req)`,
    SECTION_ORDER[p.sort ?? 'id'],
  );
  const rows = await ctx.db.all<
    { req_slug: string } & Partial<SectionCardRow> & Partial<RankedCardCols>
  >(
    `WITH req AS (
       SELECT j.key AS pos, j.value AS slug, ${APP_ID_OF_SLUG} AS app_id FROM json_each(?) j
     ),
     ranked AS (${ranked})
     SELECT req.slug AS req_slug, ranked.*
     FROM req LEFT JOIN ranked ON ranked.g_key = req.app_id AND ranked.g_rn <= ?
     WHERE req.app_id IS NOT NULL
     ORDER BY req.pos, ranked.g_rn`,
    [jsonIds(slugs), ...w.params, p.per_app],
  );
  const items: Array<{ app_slug: string; total: number; sections: SectionCard[] }> = [];
  for (const r of rows) {
    let item = items[items.length - 1];
    if (item?.app_slug !== r.req_slug) {
      item = { app_slug: r.req_slug, total: r.g_total ?? 0, sections: [] };
      items.push(item);
    }
    // An app without a matching section is one row of NULLs (the LEFT JOIN).
    if (r.id != null) item.sections.push(toSectionCard(r as SectionCardRow, ctx));
  }
  return { items };
}

// ---------------------------------------------------------------------------------------------
// Section types
// ---------------------------------------------------------------------------------------------
export async function sectionTypeInfos(
  ctx: Ctx,
  only?: readonly SectionType[],
): Promise<SectionTypeInfo[]> {
  const types = only ? SECTION_TYPES.filter((t) => only.includes(t.slug)) : SECTION_TYPES;
  const [counts, previews] = await Promise.all([
    ctx.db.all<{ section_type: string; n: number; stores: number; themes: number }>(
      `SELECT s.section_type, COUNT(*) AS n, COUNT(DISTINCT s.store_id) AS stores,
         COUNT(DISTINCT s.theme_id) AS themes
       ${FROM} WHERE s.is_current = 1 GROUP BY s.section_type`,
    ),
    sectionCards(
      ctx,
      `s.id IN (SELECT id FROM (
         SELECT x.id, ROW_NUMBER() OVER (
           PARTITION BY x.section_type ORDER BY x.is_placeholder, x.device, x.store_id, x.id) AS rn
         FROM sections x JOIN stores y ON y.id = x.store_id AND y.status = 'active'
         WHERE x.is_current = 1) WHERE rn = 1)`,
      [],
    ),
  ]);
  return types.map((t) => {
    const ref = sectionTypeRef(t.slug);
    const c = counts.find((x) => x.section_type === t.slug);
    return {
      slug: t.slug,
      name: t.name,
      description: t.description,
      group: ref.group,
      href: hrefs.sectionType(t.slug),
      count: c?.n ?? 0,
      stores: c?.stores ?? 0,
      themes: c?.themes ?? 0,
      pages: [...t.pages],
      app_categories: categoriesForSection(t.slug),
      preview: previews.find((p) => p.type.slug === t.slug) ?? null,
    };
  });
}

export async function listSectionTypes(ctx: Ctx) {
  // Types with no captured sections (e.g. cart-only ones, since carts are not captured) are left
  // out so browsing never leads to an empty page.
  const items = (await sectionTypeInfos(ctx)).filter((i) => i.count > 0);
  return {
    items,
    groups: SECTION_GROUPS.map((g) => ({
      slug: g.slug,
      name: g.name,
      count: items.filter((i) => i.group.slug === g.slug).reduce((sum, i) => sum + i.count, 0),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------
export async function getScreenshot(ctx: Ctx, id: number): Promise<ScreenshotDetail> {
  const shot = (await screenshotDetails(ctx, [id])).get(id);
  if (!shot) throw notFound(`Screenshot ${id}`);
  return shot;
}

export async function getSectionDetail(ctx: Ctx, id: number): Promise<SectionDetail> {
  const [card] = await sectionCards(ctx, 's.id = ?', [id]);
  if (!card) throw notFound(`Section ${id}`);
  const raw = await ctx.db.first<{
    store_id: number;
    theme_id: number | null;
    app_id: number | null;
  }>('SELECT store_id, theme_id, app_id FROM sections WHERE id = ?', [id]);
  const [screenshot, more, inType] = await Promise.all([
    getScreenshot(ctx, card.screenshot.id),
    sectionCards(
      ctx,
      's.section_type = ? AND s.id <> ? AND s.is_current = 1 AND s.store_id <> ?',
      // Placeholders in the ORDER BY bind after the WHERE ones (positional).
      [
        card.type.slug,
        id,
        raw?.store_id ?? 0,
        raw?.app_id ?? null,
        raw?.theme_id ?? null,
        card.device,
      ],
      `ORDER BY (s.app_id IS ?) DESC, (s.theme_id IS ?) DESC, (s.device = ?) DESC,
        st.list_position, s.id LIMIT 12`,
    ),
    typeNeighbours(ctx, card.type.slug, id),
  ]);
  return { section: card, screenshot, more_like_this: dedupeByStore(more), in_type: inType };
}

/** Position of a section within its type in library ("mixed") order, with prev/next links. */
async function typeNeighbours(
  ctx: Ctx,
  type: SectionType,
  id: number,
): Promise<SectionDetail['in_type']> {
  const where = `${FROM} WHERE s.is_current = 1 AND s.section_type = ?`;
  const key = `(${TIER_SQL}, ${MIX_SQL}, s.id)`;
  const mix = mixOf(id);
  const self = await ctx.db.first<{ tier: number }>(
    `SELECT ${TIER_SQL} AS tier FROM sections s WHERE s.id = ?`,
    [id],
  );
  const tier = self?.tier ?? 0;
  const row = await ctx.db.first<{
    position: number;
    total: number;
    prev: number | null;
    next: number | null;
  }>(
    `SELECT
       (SELECT COUNT(*) ${where} AND ${key} <= (?, ?, ?)) AS position,
       (SELECT COUNT(*) ${where}) AS total,
       (SELECT s.id ${where} AND ${key} < (?, ?, ?) ORDER BY ${TIER_SQL} DESC, ${MIX_SQL} DESC, s.id DESC LIMIT 1) AS prev,
       (SELECT s.id ${where} AND ${key} > (?, ?, ?) ORDER BY ${TIER_SQL}, ${MIX_SQL}, s.id LIMIT 1) AS next`,
    [type, tier, mix, id, type, type, tier, mix, id, type, tier, mix, id],
  );
  const link = (n: number | null | undefined) =>
    n == null ? null : { id: n, href: hrefs.section(type, n) };
  return {
    position: row?.position ?? 1,
    total: row?.total ?? 1,
    prev: link(row?.prev),
    next: link(row?.next),
  };
}

/** Keeps the first card per store so "more like this" shows variety. */
function dedupeByStore(cards: SectionCard[]): SectionCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (seen.has(c.store.domain)) return false;
    seen.add(c.store.domain);
    return true;
  });
}
