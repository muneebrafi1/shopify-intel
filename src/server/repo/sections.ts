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
import { pageTypeRef, sectionTypeRef } from './refs.ts';
import { screenshotDetails, sectionCards } from './visual.ts';

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

async function sectionFacets(ctx: Ctx, f: SectionFilters): Promise<ListSectionsOutput['facets']> {
  const run = <Row>(omit: Key[], sql: (where: string) => string) => {
    const w = sectionWhere(f, omit);
    return ctx.db.all<Row>(sql(w.sql), w.params);
  };
  type Count = { value: string; count: number };
  const [types, groups, pages, devices, themes, apps] = await Promise.all([
    run<Count>(
      ['type', 'group'],
      (w) =>
        `SELECT s.section_type AS value, COUNT(*) AS count ${FROM} WHERE ${w} GROUP BY s.section_type`,
    ),
    run<Count>(
      ['type', 'group'],
      (w) => `SELECT ty.group_slug AS value, COUNT(*) AS count ${FROM}
        JOIN section_types ty ON ty.slug = s.section_type WHERE ${w} GROUP BY ty.group_slug`,
    ),
    run<Count>(
      ['page_type'],
      (w) =>
        `SELECT s.page_type AS value, COUNT(*) AS count ${FROM} WHERE ${w} GROUP BY s.page_type`,
    ),
    run<Count>(
      ['device'],
      (w) => `SELECT s.device AS value, COUNT(*) AS count ${FROM} WHERE ${w} GROUP BY s.device`,
    ),
    run<Facet>(
      ['themeId'],
      (w) => `SELECT t.slug AS value, t.name AS label, COUNT(*) AS count ${FROM}
        JOIN themes t ON t.id = s.theme_id WHERE ${w}
        GROUP BY t.id ORDER BY count DESC, t.name LIMIT 30`,
    ),
    run<Facet>(
      ['appId'],
      (w) => `SELECT a.slug AS value, a.short_name AS label, COUNT(*) AS count ${FROM}
        JOIN apps a ON a.id = s.app_id WHERE ${w}
        GROUP BY a.id ORDER BY count DESC, a.short_name LIMIT 30`,
    ),
  ]);
  // Taxonomy order for fixed vocabularies.
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

export interface ListSectionsParams {
  type?: SectionType | undefined;
  group?: string | undefined;
  page_type?: string | undefined;
  device?: string | undefined;
  theme?: string | undefined;
  app?: string | undefined;
  store?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

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
  const seek = p.cursor ? (decodeCursor(p.cursor, 1)[0] ?? null) : null;
  const [items, total, facets, typeInfo] = await Promise.all([
    sectionCards(
      ctx,
      `${w.sql}${seek !== null ? ' AND s.id > ?' : ''}`,
      seek !== null ? [...w.params, seek] : w.params,
      `ORDER BY s.id LIMIT ${p.limit + 1}`,
    ),
    ctx.db.first<{ n: number }>(`SELECT COUNT(*) AS n ${FROM} WHERE ${w.sql}`, w.params),
    sectionFacets(ctx, f),
    p.type ? sectionTypeInfos(ctx, [p.type]) : Promise.resolve([]),
  ]);
  const page = items.slice(0, p.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    facets,
    section_type: typeInfo[0] ?? null,
    pagination: {
      limit: p.limit,
      next_cursor: items.length > p.limit && last ? encodeCursor([last.id]) : null,
      total: total?.n ?? 0,
    },
  };
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
  const items = await sectionTypeInfos(ctx);
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

/** Position of a section within its type in library order (by id), with prev/next links. */
async function typeNeighbours(
  ctx: Ctx,
  type: SectionType,
  id: number,
): Promise<SectionDetail['in_type']> {
  const where = `${FROM} WHERE s.is_current = 1 AND s.section_type = ?`;
  const row = await ctx.db.first<{
    position: number;
    total: number;
    prev: number | null;
    next: number | null;
  }>(
    `SELECT
       (SELECT COUNT(*) ${where} AND s.id <= ?) AS position,
       (SELECT COUNT(*) ${where}) AS total,
       (SELECT MAX(s.id) ${where} AND s.id < ?) AS prev,
       (SELECT MIN(s.id) ${where} AND s.id > ?) AS next`,
    [type, id, type, type, id, type, id],
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
