/**
 * Row → API shape mappers shared by all repositories, plus the SQL column fragments that feed
 * them. Keeping the aliases in one place keeps every endpoint's refs identical.
 */
import {
  APP_CATEGORY_SURFACES,
  PAGE_TYPES,
  SECTION_GROUPS,
  SECTION_TYPES,
  type PageType,
  type SectionType,
} from '../../lib/taxonomy.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { Ctx } from '../api/v1/context.ts';
import type {
  AppRef,
  CategoryRef,
  EntityRef,
  Hints,
  PageTypeRef,
  Price,
  SectionTypeRef,
  StoreRef,
  StoreThemeInfo,
  ThemeRef,
  UsageStat,
} from '../api/v1/schemas/common.ts';
import type { AppPricing } from '../api/v1/schemas/apps.ts';

export const bool = (v: number | null | undefined): boolean => v === 1;
export const boolOrNull = (v: number | null | undefined): boolean | null =>
  v === null || v === undefined ? null : v === 1;

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------
export interface StoreRefRow {
  domain: string;
  name: string | null;
  is_curated: number;
}

export const storeRef = (r: StoreRefRow): StoreRef => ({
  domain: r.domain,
  name: r.name,
  display_name: r.name ?? r.domain,
  href: hrefs.store(r.domain),
  is_curated: bool(r.is_curated),
});

/** Store theme columns (stores s LEFT JOIN themes t ON t.id = s.current_theme_id). */
export const STORE_THEME_COLS = `t.slug AS theme_slug, t.name AS theme_name, t.vendor AS theme_vendor,
  s.current_theme_name AS theme_raw_name, s.current_theme_version AS theme_version,
  s.current_theme_is_custom AS theme_is_custom`;

export interface StoreThemeRow {
  theme_slug: string | null;
  theme_name: string | null;
  theme_vendor: string | null;
  theme_raw_name: string | null;
  theme_version: string | null;
  theme_is_custom: number;
}

export function storeThemeInfo(r: StoreThemeRow): StoreThemeInfo {
  const theme =
    r.theme_slug && r.theme_name
      ? themeRef({ slug: r.theme_slug, name: r.theme_name, vendor: r.theme_vendor })
      : null;
  const name = r.theme_raw_name ?? r.theme_name;
  const custom = bool(r.theme_is_custom);
  const label = custom
    ? 'Custom theme'
    : name
      ? [theme?.name ?? name, r.theme_version].filter(Boolean).join(' ')
      : 'Theme not detected';
  return { theme, name, version: r.theme_version, is_custom: custom, label };
}

// ---------------------------------------------------------------------------------------------
// Themes, apps, categories
// ---------------------------------------------------------------------------------------------
export const themeRef = (r: { slug: string; name: string; vendor: string | null }): ThemeRef => ({
  slug: r.slug,
  name: r.name,
  vendor: r.vendor,
  href: hrefs.theme(r.slug),
});

export const categoryRef = (slug: string | null, name: string | null): CategoryRef | null =>
  slug && name ? { slug, name, href: hrefs.appCategory(slug) } : null;

/** App columns (apps a LEFT JOIN app_categories ac ON ac.id = a.category_id). */
export const APP_REF_COLS = `a.slug AS app_slug, a.name AS app_name, a.short_name AS app_short_name,
  a.icon_url AS app_icon_url, ac.slug AS app_cat_slug, ac.name AS app_cat_name`;

export interface AppRefRow {
  app_slug: string;
  app_name: string;
  app_short_name: string | null;
  app_icon_url: string | null;
  app_cat_slug: string | null;
  app_cat_name: string | null;
}

export const appRef = (r: AppRefRow): AppRef => ({
  slug: r.app_slug,
  name: r.app_name,
  short_name: r.app_short_name ?? r.app_name,
  icon_url: r.app_icon_url,
  href: hrefs.app(r.app_slug),
  category: categoryRef(r.app_cat_slug, r.app_cat_name),
});

export const entityRef = (
  kind: 'app' | 'theme',
  r: { slug: string; name: string; icon_url?: string | null },
): EntityRef => ({
  kind,
  slug: r.slug,
  name: r.name,
  icon_url: r.icon_url ?? null,
  href: kind === 'app' ? hrefs.app(r.slug) : hrefs.theme(r.slug),
});

// ---------------------------------------------------------------------------------------------
// Taxonomy (in memory; no DB round trip)
// ---------------------------------------------------------------------------------------------
export function sectionTypeRef(slug: string): SectionTypeRef {
  const t = SECTION_TYPES.find((s) => s.slug === slug);
  if (!t) throw new Error(`Unknown section type ${slug}`);
  const g = SECTION_GROUPS.find((x) => x.slug === t.group);
  return {
    slug: t.slug,
    name: t.name,
    group: { slug: t.group, name: g?.name ?? t.group },
    href: hrefs.sectionType(t.slug),
  };
}

export function pageTypeRef(slug: string): PageTypeRef {
  const p = PAGE_TYPES.find((x) => x.slug === slug);
  if (!p) throw new Error(`Unknown page type ${slug}`);
  return { slug: p.slug, name: p.name };
}

export const isPageType = (v: string): v is PageType => PAGE_TYPES.some((p) => p.slug === v);
export const isSectionType = (v: string): v is SectionType =>
  SECTION_TYPES.some((s) => s.slug === v);

/** Section types an app category usually renders (taxonomy). */
export const categorySurfaces = (categoryName: string | null): SectionTypeRef[] =>
  (categoryName ? (APP_CATEGORY_SURFACES[categoryName] ?? []) : []).map(sectionTypeRef);

// ---------------------------------------------------------------------------------------------
// Numbers with provenance
// ---------------------------------------------------------------------------------------------
export function usageStat(
  ctx: Ctx,
  stores: number | null,
  denominator: number | null,
  rank: number | null,
): UsageStat {
  const denom = denominator ?? ctx.data.scannedTotal;
  const n = stores ?? 0;
  return {
    stores: n,
    share: denom > 0 ? Math.round((n / denom) * 10000) / 10000 : 0,
    denominator: denom,
    rank: n > 0 ? rank : null,
    source: ctx.data.scanSourceId,
    as_of: ctx.data.dataAsOf,
  };
}

export const ratio = (n: number, d: number): number =>
  d > 0 ? Math.round((n / d) * 10000) / 10000 : 0;

export function price(cents: number | null, label: string | null): Price {
  return { cents, label, is_free: cents === null ? null : cents === 0 };
}

const dollars = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export function appPricing(r: {
  free_plan: number | null;
  from_price_cents: number | null;
  trial_days: number | null;
}): AppPricing {
  const parts: string[] = [];
  if (r.free_plan === 1) parts.push('Free plan');
  if (r.from_price_cents !== null && r.from_price_cents > 0) {
    parts.push(`from ${dollars(r.from_price_cents)}/mo`);
  }
  const label = parts.length ? parts.join(' · ').replace(/^from/, 'From') : null;
  return {
    free_plan: boolOrNull(r.free_plan),
    from_cents: r.from_price_cents,
    label,
    trial_days: r.trial_days,
  };
}

// ---------------------------------------------------------------------------------------------
// JSON columns
// ---------------------------------------------------------------------------------------------
export function parseHints(json: string | null): Hints | null {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Hints = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out[k] = x;
    }
    return out;
  } catch {
    return null;
  }
}

export function parseStringArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** JSON array of ids for `IN (SELECT value FROM json_each(?))` (sidesteps D1's 100-param cap). */
export const jsonIds = (ids: ReadonlyArray<number | string>): string => JSON.stringify(ids);

/** Rows grouped by a key, each group in row order (splits per-entity windowed queries). */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = out.get(k);
    if (group) group.push(row);
    else out.set(k, [row]);
  }
  return out;
}
