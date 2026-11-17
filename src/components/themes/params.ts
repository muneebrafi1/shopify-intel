/**
 * URL state for the themes pages. Filters are query params (shareable, crawlable, no JS):
 *   /themes?price=free|paid|under-300|300-399|400-plus&vendor=<slug>&sort=usage|name|price&view=index&p=2
 *   /themes/<slug>?page=home|collection|product|cart&device=desktop|mobile&cursor=…&p=2#stores
 * One `price` param covers both the API's `price` (free/paid) and `price_band` filters.
 */
import { CORE_PAGE_TYPES, type Device, type PageType } from '~/lib/taxonomy';

export const PRICE_FILTERS = ['free', 'paid', 'under-300', '300-399', '400-plus'] as const;
export type PriceFilter = (typeof PRICE_FILTERS)[number];

export const SORTS = [
  { value: 'usage', label: 'Most used' },
  { value: 'name', label: 'Name' },
  { value: 'price', label: 'Price' },
] as const;
export type ThemeSort = (typeof SORTS)[number]['value'];

export interface IndexState {
  price?: PriceFilter;
  vendor?: string;
  sort: ThemeSort;
  view: 'grid' | 'index';
  p: number;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function readIndexState(sp: URLSearchParams): IndexState {
  const price = sp.get('price');
  const vendor = sp.get('vendor')?.trim().toLowerCase();
  const sort = sp.get('sort');
  const p = Number.parseInt(sp.get('p') ?? '1', 10);
  return {
    price: (PRICE_FILTERS as readonly string[]).includes(price ?? '')
      ? (price as PriceFilter)
      : undefined,
    vendor: vendor && SLUG.test(vendor) ? vendor : undefined,
    sort: SORTS.some((s) => s.value === sort) ? (sort as ThemeSort) : 'usage',
    view: sp.get('view') === 'index' ? 'index' : 'grid',
    p: Number.isFinite(p) && p > 1 ? Math.min(p, 999) : 1,
  };
}

/** Builds a /themes URL from a state, dropping defaults so URLs stay short and canonical. */
export function indexHref(state: IndexState, patch: Partial<IndexState> = {}): string {
  const s = { ...state, p: 1, ...patch };
  const q = new URLSearchParams();
  if (s.price) q.set('price', s.price);
  if (s.vendor) q.set('vendor', s.vendor);
  if (s.sort !== 'usage') q.set('sort', s.sort);
  if (s.view === 'index') q.set('view', 'index');
  if (s.p > 1) q.set('p', String(s.p));
  const qs = q.toString();
  return qs ? `/themes?${qs}` : '/themes';
}

/** The API input for a price filter: `paid` uses `price`, the rest are price bands. */
export function apiPriceInput(price: PriceFilter | undefined) {
  if (!price) return {};
  if (price === 'paid') return { price: 'paid' as const };
  return { price_band: price };
}

// ---------------------------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------------------------
export interface PlateState {
  page: PageType;
  device: Device;
}

export function readPlateState(sp: URLSearchParams, pages: readonly PageType[]): PlateState {
  const page = sp.get('page') as PageType | null;
  const device = sp.get('device');
  const available = pages.length ? pages : CORE_PAGE_TYPES;
  return {
    page: page && available.includes(page) ? page : (available[0] ?? 'home'),
    device: device === 'mobile' ? 'mobile' : 'desktop',
  };
}

/** Detail URL with plate state (defaults dropped) and an optional stores-list page. */
export function detailHref(
  slug: string,
  plate: PlateState,
  extra: { cursor?: string | null; p?: number; hash?: string } = {},
): string {
  const q = new URLSearchParams();
  if (plate.page !== 'home') q.set('page', plate.page);
  if (plate.device !== 'desktop') q.set('device', plate.device);
  if (extra.cursor) q.set('cursor', extra.cursor);
  if (extra.p && extra.p > 1) q.set('p', String(extra.p));
  const qs = q.toString();
  return `/themes/${slug}${qs ? `?${qs}` : ''}${extra.hash ? `#${extra.hash}` : ''}`;
}

/** "N°003" */
export const specimenNo = (n: number) => `N°${String(n).padStart(3, '0')}`;

/** Highest semantic version in a list ("9.3.0" > "9.10.0" handled numerically). */
export function latestVersion(versions: readonly (string | null)[]): string | null {
  const parts = (v: string) => v.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  let best: string | null = null;
  for (const v of versions) {
    if (!v) continue;
    if (!best) {
      best = v;
      continue;
    }
    const a = parts(v);
    const b = parts(best);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) {
        if (d > 0) best = v;
        break;
      }
    }
  }
  return best;
}
