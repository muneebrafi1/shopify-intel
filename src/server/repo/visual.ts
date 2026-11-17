/**
 * Screenshots and sections: the shared queries and mappers behind store pages, the sections
 * library, theme/app "seen on" blocks and teardowns.
 */
import type { Ctx } from '../api/v1/context.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type {
  ScreenshotDetail,
  ScreenshotThumb,
  SectionCard,
  ShotSection,
} from '../api/v1/schemas/common.ts';
import type { SqlValue } from '../db/types.ts';
import { screenshotImage, sectionCropImage } from '../media/urls.ts';
import {
  APP_REF_COLS,
  appRef,
  bool,
  jsonIds,
  pageTypeRef,
  parseHints,
  sectionTypeRef,
  storeRef,
  themeRef,
  type AppRefRow,
} from './refs.ts';

type DeviceSlug = 'desktop' | 'mobile';
const asDevice = (v: string): DeviceSlug => (v === 'mobile' ? 'mobile' : 'desktop');

// ---------------------------------------------------------------------------------------------
// Screenshot thumbs
// ---------------------------------------------------------------------------------------------
export const THUMB_COLS = `sh.id, sh.store_id, sh.page_type, sh.device, sh.is_placeholder,
  sh.captured_at, sh.r2_key, sh.width, sh.height`;

export interface ThumbRow {
  id: number;
  store_id: number;
  page_type: string;
  device: string;
  is_placeholder: number;
  captured_at: string | null;
  r2_key: string | null;
  width: number;
  height: number;
}

export function toThumb(r: ThumbRow, ctx: Ctx): ScreenshotThumb {
  return {
    id: r.id,
    page_type: pageTypeRef(r.page_type).slug,
    device: asDevice(r.device),
    is_placeholder: bool(r.is_placeholder),
    captured_at: r.captured_at,
    image: screenshotImage(r, ctx.media),
  };
}

/** Current home/desktop screenshot per store (the list preview). */
export async function homePreviews(
  ctx: Ctx,
  storeIds: readonly number[],
): Promise<Map<number, ScreenshotThumb>> {
  if (storeIds.length === 0) return new Map();
  const rows = await ctx.db.all<ThumbRow>(
    `SELECT ${THUMB_COLS} FROM screenshots sh
     WHERE sh.store_id IN (SELECT value FROM json_each(?)) AND sh.is_current = 1
       AND sh.page_type = 'home' AND sh.device = 'desktop'
     ORDER BY sh.is_placeholder, sh.id`,
    [jsonIds(storeIds)],
  );
  const out = new Map<number, ScreenshotThumb>();
  for (const r of rows) if (!out.has(r.store_id)) out.set(r.store_id, toThumb(r, ctx));
  return out;
}

/** All current thumbs for the given stores, grouped by store. */
export async function thumbsByStore(
  ctx: Ctx,
  storeIds: readonly number[],
): Promise<Map<number, ScreenshotThumb[]>> {
  const out = new Map<number, ScreenshotThumb[]>();
  if (storeIds.length === 0) return out;
  const rows = await ctx.db.all<ThumbRow>(
    `SELECT ${THUMB_COLS} FROM screenshots sh
     WHERE sh.store_id IN (SELECT value FROM json_each(?)) AND sh.is_current = 1
     ORDER BY sh.store_id, sh.id`,
    [jsonIds(storeIds)],
  );
  for (const r of rows) out.set(r.store_id, [...(out.get(r.store_id) ?? []), toThumb(r, ctx)]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Section cards (library tiles)
// ---------------------------------------------------------------------------------------------
export const SECTION_CARD_FROM = `FROM sections s
  JOIN screenshots sh ON sh.id = s.screenshot_id
  JOIN stores st ON st.id = s.store_id AND st.status = 'active'
  LEFT JOIN themes t ON t.id = s.theme_id
  LEFT JOIN apps a ON a.id = s.app_id
  LEFT JOIN app_categories ac ON ac.id = a.category_id`;

export const SECTION_CARD_COLS = `s.id, s.section_type, s.page_type, s.device, s.x, s.y, s.w,
  s.height, s.r2_key_crop, s.is_placeholder, s.hints_json,
  sh.id AS shot_id, sh.width AS shot_width, sh.height AS shot_height, sh.r2_key AS shot_r2_key,
  sh.is_placeholder AS shot_is_placeholder,
  st.domain AS store_domain, st.name AS store_name, st.is_curated AS store_is_curated,
  t.slug AS theme_slug, t.name AS theme_name, t.vendor AS theme_vendor,
  ${APP_REF_COLS}`;

export interface SectionCardRow extends Omit<AppRefRow, 'app_slug' | 'app_name'> {
  id: number;
  section_type: string;
  page_type: string;
  device: string;
  x: number;
  y: number;
  w: number | null;
  height: number;
  r2_key_crop: string | null;
  is_placeholder: number;
  hints_json: string | null;
  shot_id: number;
  shot_width: number;
  shot_height: number;
  shot_r2_key: string | null;
  shot_is_placeholder: number;
  store_domain: string;
  store_name: string | null;
  store_is_curated: number;
  theme_slug: string | null;
  theme_name: string | null;
  theme_vendor: string | null;
  app_slug: string | null;
  app_name: string | null;
}

export function toSectionCard(r: SectionCardRow, ctx: Ctx): SectionCard {
  const type = sectionTypeRef(r.section_type);
  return {
    id: r.id,
    href: hrefs.section(type.slug, r.id),
    type,
    page_type: pageTypeRef(r.page_type).slug,
    device: asDevice(r.device),
    rect: { x: r.x, y: r.y, w: r.w ?? r.shot_width, h: r.height },
    crop: sectionCropImage(r, r.shot_width, ctx.media),
    screenshot: {
      id: r.shot_id,
      width: r.shot_width,
      height: r.shot_height,
      image: screenshotImage(
        {
          id: r.shot_id,
          r2_key: r.shot_r2_key,
          width: r.shot_width,
          height: r.shot_height,
          is_placeholder: r.shot_is_placeholder,
        },
        ctx.media,
      ),
    },
    store: storeRef({ domain: r.store_domain, name: r.store_name, is_curated: r.store_is_curated }),
    theme:
      r.theme_slug && r.theme_name
        ? themeRef({ slug: r.theme_slug, name: r.theme_name, vendor: r.theme_vendor })
        : null,
    app:
      r.app_slug && r.app_name
        ? appRef({ ...r, app_slug: r.app_slug, app_name: r.app_name })
        : null,
    hints: parseHints(r.hints_json),
    is_placeholder: bool(r.is_placeholder),
  };
}

/** Section cards matching a WHERE clause (on aliases s, sh, st, t, a). */
export async function sectionCards(
  ctx: Ctx,
  where: string,
  params: readonly SqlValue[],
  tail = 'ORDER BY s.id',
): Promise<SectionCard[]> {
  const rows = await ctx.db.all<SectionCardRow>(
    `SELECT ${SECTION_CARD_COLS} ${SECTION_CARD_FROM} WHERE ${where} ${tail}`,
    params,
  );
  return rows.map((r) => toSectionCard(r, ctx));
}

/** Columns a ranked card query adds: the group key, rank within it and the group's size. */
export interface RankedCardCols {
  g_key: SqlValue;
  g_rn: number;
  g_total: number;
}

/**
 * The card query as a window: every card matching `where`, with its 1-based rank within its
 * `group` in `order` and the group's size (`COUNT(*)` over the same rows). `where` and `order`
 * use the card aliases (s, sh, st, t, a). Wrap it and cut on `g_rn` to keep the first N cards of
 * every group in one statement instead of one query per group.
 */
export const rankedCardsSql = (group: string, where: string, order: string) =>
  `SELECT ${SECTION_CARD_COLS}, ${group} AS g_key,
     ROW_NUMBER() OVER (PARTITION BY ${group} ORDER BY ${order}) AS g_rn,
     COUNT(*) OVER (PARTITION BY ${group}) AS g_total
   ${SECTION_CARD_FROM} WHERE ${where}`;

/**
 * The first `per` section cards of each group, and each group's total, in one query (see
 * `rankedCardsSql`). Groups without a matching card are absent from the map.
 */
export async function groupedSectionCards(
  ctx: Ctx,
  opts: {
    group: string;
    where: string;
    params: readonly SqlValue[];
    order: string;
    per: number;
  },
): Promise<Map<SqlValue, { total: number; cards: SectionCard[] }>> {
  // At least one row per group is read so its total is known even when `per` is 0.
  const rows = await ctx.db.all<SectionCardRow & RankedCardCols>(
    `SELECT * FROM (${rankedCardsSql(opts.group, opts.where, opts.order)})
     WHERE g_rn <= ? ORDER BY g_key, g_rn`,
    [...opts.params, Math.max(1, opts.per)],
  );
  const out = new Map<SqlValue, { total: number; cards: SectionCard[] }>();
  for (const r of rows) {
    let group = out.get(r.g_key);
    if (!group) out.set(r.g_key, (group = { total: r.g_total, cards: [] }));
    if (r.g_rn <= opts.per) group.cards.push(toSectionCard(r, ctx));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Screenshot detail (shot + every section on it)
// ---------------------------------------------------------------------------------------------
interface ShotRow extends ThumbRow {
  viewport_w: number;
  is_current: number;
  store_domain: string;
  store_name: string | null;
  store_is_curated: number;
  theme_slug: string | null;
  theme_name: string | null;
  theme_vendor: string | null;
}

interface ShotSectionRow {
  id: number;
  screenshot_id: number;
  section_type: string;
  x: number;
  y: number;
  w: number | null;
  height: number;
  order_index: number;
  theme_section_name: string | null;
  r2_key_crop: string | null;
  is_placeholder: number;
  hints_json: string | null;
  app_slug: string | null;
  app_name: string | null;
  app_short_name: string | null;
  app_icon_url: string | null;
  app_cat_slug: string | null;
  app_cat_name: string | null;
}

function toShotSection(r: ShotSectionRow, shotWidth: number, ctx: Ctx): ShotSection {
  const type = sectionTypeRef(r.section_type);
  const hints = parseHints(r.hints_json);
  const column = hints?.column === 'left' || hints?.column === 'right' ? hints.column : null;
  return {
    id: r.id,
    href: hrefs.section(type.slug, r.id),
    type,
    rect: { x: r.x, y: r.y, w: r.w ?? shotWidth, h: r.height },
    order_index: r.order_index,
    column,
    app:
      r.app_slug && r.app_name
        ? appRef({ ...r, app_slug: r.app_slug, app_name: r.app_name })
        : null,
    theme_section_name: r.theme_section_name,
    hints,
    is_placeholder: bool(r.is_placeholder),
    crop: sectionCropImage(r, shotWidth, ctx.media),
  };
}

/**
 * Screenshot details for the given ids (only shots of active stores). Two queries regardless of
 * how many shots: one for the shots, one for all their sections.
 */
export async function screenshotDetails(
  ctx: Ctx,
  shotIds: readonly number[],
): Promise<Map<number, ScreenshotDetail>> {
  const out = new Map<number, ScreenshotDetail>();
  if (shotIds.length === 0) return out;
  const ids = jsonIds(shotIds);
  const [shots, sections] = await Promise.all([
    ctx.db.all<ShotRow>(
      `SELECT ${THUMB_COLS}, sh.viewport_w, sh.is_current,
         st.domain AS store_domain, st.name AS store_name, st.is_curated AS store_is_curated,
         t.slug AS theme_slug, t.name AS theme_name, t.vendor AS theme_vendor
       FROM screenshots sh
       JOIN stores st ON st.id = sh.store_id AND st.status = 'active'
       LEFT JOIN themes t ON t.id = sh.theme_id
       WHERE sh.id IN (SELECT value FROM json_each(?))`,
      [ids],
    ),
    ctx.db.all<ShotSectionRow>(
      `SELECT s.id, s.screenshot_id, s.section_type, s.x, s.y, s.w, s.height, s.order_index,
         s.theme_section_name, s.r2_key_crop, s.is_placeholder, s.hints_json, ${APP_REF_COLS}
       FROM sections s
       LEFT JOIN apps a ON a.id = s.app_id
       LEFT JOIN app_categories ac ON ac.id = a.category_id
       WHERE s.screenshot_id IN (SELECT value FROM json_each(?))
       ORDER BY s.screenshot_id, s.order_index`,
      [ids],
    ),
  ]);
  const bySho = new Map<number, ShotSectionRow[]>();
  for (const s of sections) bySho.set(s.screenshot_id, [...(bySho.get(s.screenshot_id) ?? []), s]);
  for (const r of shots) {
    out.set(r.id, {
      id: r.id,
      page_type: pageTypeRef(r.page_type),
      device: asDevice(r.device),
      viewport_w: r.viewport_w,
      width: r.width,
      height: r.height,
      is_placeholder: bool(r.is_placeholder),
      is_current: bool(r.is_current),
      captured_at: r.captured_at,
      image: screenshotImage(r, ctx.media),
      store: storeRef({
        domain: r.store_domain,
        name: r.store_name,
        is_curated: r.store_is_curated,
      }),
      theme:
        r.theme_slug && r.theme_name
          ? themeRef({ slug: r.theme_slug, name: r.theme_name, vendor: r.theme_vendor })
          : null,
      sections: (bySho.get(r.id) ?? []).map((s) => toShotSection(s, r.width, ctx)),
    });
  }
  return out;
}
