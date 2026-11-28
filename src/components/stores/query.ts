/**
 * URL state for /stores. Filters are query params (shareable, crawlable, work without JS).
 *
 * Scope (owner decision, 17 Nov 2026): the page shows the curated stores by default, with or
 * without filters. `scope=all` includes every detected store.
 *
 * View rules:
 *  - curated: `grid` (default) shows captures as cards; `view=index` shows the same stores as a
 *    table.
 *  - all: always the table. Most detected stores have no capture, so a card grid would be a
 *    wall of empty wells; `view` is ignored.
 */
export const STORE_SORTS = [
  { value: 'rank', label: 'Tranco rank' },
  { value: 'apps', label: 'Most apps' },
  { value: 'recent', label: 'Recently seen' },
  { value: 'domain', label: 'Domain A–Z' },
] as const;
export type StoreSort = (typeof STORE_SORTS)[number]['value'];

export const FILTER_KEYS = ['theme', 'app', 'category', 'currency', 'country', 'capture'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type CaptureFilter = 'planned' | 'captured';
export type StoreView = 'grid' | 'index';
export type StoreScope = 'curated' | 'all';

export interface StoreQuery {
  filters: Partial<Record<FilterKey, string>>;
  /** Domain or name search (prefix match in the API). */
  q: string | null;
  scope: StoreScope;
  sort: StoreSort;
  /** The view as requested in the URL (null = the scope's default). */
  viewParam: StoreView | null;
  view: StoreView;
  cursor: string | null;
  /** 1-based page number that travels with the cursor (row numbers continue across pages). */
  p: number;
}

const clean = (v: string | null, max = 80) => {
  const s = v?.trim();
  return s && s.length <= max ? s : undefined;
};

export const defaultView = (scope: StoreScope): StoreView => (scope === 'all' ? 'index' : 'grid');

export function parseStoreQuery(url: URL): StoreQuery {
  const sp = url.searchParams;
  const filters: StoreQuery['filters'] = {};
  const theme = clean(sp.get('theme'))?.toLowerCase();
  const app = clean(sp.get('app'))?.toLowerCase();
  const category = clean(sp.get('category'))?.toLowerCase();
  const currency = clean(sp.get('currency'), 3)?.toUpperCase();
  const country = clean(sp.get('country'), 2)?.toUpperCase();
  const capture = sp.get('capture');
  if (theme) filters.theme = theme;
  if (app) filters.app = app;
  if (category) filters.category = category;
  if (currency && /^[A-Z]{3}$/.test(currency)) filters.currency = currency;
  if (country && /^[A-Z]{2}$/.test(country)) filters.country = country;
  if (capture === 'planned' || capture === 'captured') filters.capture = capture;

  const q = clean(sp.get('q'), 100) ?? null;
  const scope: StoreScope = sp.get('scope') === 'all' ? 'all' : 'curated';
  const sortParam = sp.get('sort');
  const sort = (STORE_SORTS.find((s) => s.value === sortParam)?.value ?? 'rank') as StoreSort;
  const v = sp.get('view');
  const viewParam: StoreView | null = v === 'grid' || v === 'index' ? v : null;
  const view: StoreView = scope === 'all' ? 'index' : (viewParam ?? defaultView(scope));
  const cursor = clean(sp.get('cursor'), 400) ?? null;
  const pRaw = Number.parseInt(sp.get('p') ?? '1', 10);
  const p = cursor && Number.isFinite(pRaw) && pRaw > 1 ? Math.min(pRaw, 10_000) : 1;
  return { filters, q, scope, sort, viewParam, view, cursor, p };
}

/** Build a /stores URL. Defaults (curated scope, rank sort, the scope's view) are omitted. */
export function storesHref(
  filters: StoreQuery['filters'],
  opts: {
    q?: string | null;
    scope?: StoreScope;
    sort?: StoreSort;
    view?: StoreView | null;
    cursor?: string | null;
    p?: number;
  } = {},
): string {
  const sp = new URLSearchParams();
  const scope = opts.scope ?? 'curated';
  if (opts.q) sp.set('q', opts.q);
  if (scope === 'all') sp.set('scope', 'all');
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) sp.set(key, value);
  }
  if (opts.sort && opts.sort !== 'rank') sp.set('sort', opts.sort);
  if (scope === 'curated' && opts.view && opts.view !== defaultView(scope)) {
    sp.set('view', opts.view);
  }
  if (opts.cursor) {
    sp.set('cursor', opts.cursor);
    if (opts.p && opts.p > 1) sp.set('p', String(opts.p));
  }
  const qs = sp.toString();
  return qs ? `/stores?${qs}` : '/stores';
}

/** API input for the current filters and search (without scope/limit/cursor). */
export function apiFilters(filters: StoreQuery['filters'], q?: string | null) {
  return {
    ...(q ? { q } : {}),
    ...(filters.theme ? { theme: filters.theme } : {}),
    ...(filters.app ? { app: filters.app } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.country ? { country: filters.country } : {}),
    ...(filters.capture === 'planned' ? { curated: true } : {}),
    ...(filters.capture === 'captured' ? { captured: true } : {}),
  };
}

/** "Prestige" from a store's theme info (the version lives in its own column). */
export const themeName = (t: {
  name: string | null;
  label: string;
  theme?: { name: string } | null;
}) => {
  if (t.theme?.name) return t.theme.name;
  // Raw theme names are often a merchant's working label ("[Production] BFCM 11/26", "UAT"):
  // show those as a custom theme instead of leaking the label.
  const raw = t.name?.trim();
  if (!raw || INTERNAL_THEME_LABEL.test(raw)) return raw ? 'Custom theme' : t.label;
  return raw;
};
const INTERNAL_THEME_LABEL =
  /^\[|\b(production|staging|uat|bfcm|black friday|cyber|post[- ]sale|copy of|backup|refs\/|branch|github|live)\b|\d{1,2}[/-]\d{1,2}\b|^main\b|\/main$/i;
