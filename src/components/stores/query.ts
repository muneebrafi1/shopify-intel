/**
 * URL state for /stores. Filters are query params (shareable, crawlable, work without JS).
 *
 * View rules:
 *  - `grid` shows the curated stores as captures (only they have a capture plan).
 *  - `index` shows every detected store as numbered rows.
 *  - With no `view` param, the page shows the grid, unless a filter is set: filters reach the
 *    stores we only detected, so they open the index.
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

export interface StoreQuery {
  filters: Partial<Record<FilterKey, string>>;
  sort: StoreSort;
  /** The view as requested in the URL (null = default for the filters). */
  viewParam: StoreView | null;
  view: StoreView;
  cursor: string | null;
  /** 1-based page number that travels with the cursor (for N° numbering). */
  p: number;
}

const clean = (v: string | null, max = 80) => {
  const s = v?.trim();
  return s && s.length <= max ? s : undefined;
};

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

  const sortParam = sp.get('sort');
  const sort = (STORE_SORTS.find((s) => s.value === sortParam)?.value ?? 'rank') as StoreSort;
  const v = sp.get('view');
  const viewParam: StoreView | null = v === 'grid' || v === 'index' ? v : null;
  const hasFilters = Object.keys(filters).length > 0;
  const view: StoreView = viewParam ?? (hasFilters ? 'index' : 'grid');
  const cursor = clean(sp.get('cursor'), 400) ?? null;
  const pRaw = Number.parseInt(sp.get('p') ?? '1', 10);
  const p = cursor && Number.isFinite(pRaw) && pRaw > 1 ? Math.min(pRaw, 10_000) : 1;
  return { filters, sort, viewParam, view, cursor, p };
}

export const defaultView = (filters: StoreQuery['filters']): StoreView =>
  Object.keys(filters).length > 0 ? 'index' : 'grid';

/** Build a /stores URL. `view` is only written when it differs from the default. */
export function storesHref(
  filters: StoreQuery['filters'],
  opts: { sort?: StoreSort; view?: StoreView | null; cursor?: string | null; p?: number } = {},
): string {
  const sp = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) sp.set(key, value);
  }
  if (opts.sort && opts.sort !== 'rank') sp.set('sort', opts.sort);
  if (opts.view && opts.view !== defaultView(filters)) sp.set('view', opts.view);
  if (opts.cursor) {
    sp.set('cursor', opts.cursor);
    if (opts.p && opts.p > 1) sp.set('p', String(opts.p));
  }
  const qs = sp.toString();
  return qs ? `/stores?${qs}` : '/stores';
}

/** API input for the current filters (without curated/limit/cursor). */
export function apiFilters(filters: StoreQuery['filters']) {
  return {
    ...(filters.theme ? { theme: filters.theme } : {}),
    ...(filters.app ? { app: filters.app } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.country ? { country: filters.country } : {}),
    ...(filters.capture === 'planned' ? { curated: true } : {}),
    ...(filters.capture === 'captured' ? { captured: true } : {}),
  };
}

/** Zero-padded specimen number: 14 → "N°014". */
export const specimen = (n: number) => `N°${String(n).padStart(3, '0')}`;
