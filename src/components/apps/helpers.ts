/**
 * Small, pure helpers shared by the apps pages (index, categories, detail). Formatting lives in
 * `~/lib/format`; this file only adds apps-specific wording and URL building.
 */
import type { AppPricing, SectionCard, UsageStat } from '~/server/api/v1/types';
import { formatDate, formatPrice } from '~/lib/format';

/** Specimen number label: 2 → "N°002". */
export const specimen = (n: number, pad = 3) => `N°${String(n).padStart(pad, '0')}`;

/** Share 0..1 → "23.8%" (one decimal, "<0.1%" for tiny shares). */
export function sharePct(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

/**
 * Compact "price from" for dense rows: "Free · $15/mo", "$149/mo", "Free", or null when the
 * listing has not been read.
 */
export function priceFrom(p: AppPricing): string | null {
  if (typeof p.from_cents === 'number' && p.from_cents > 0) {
    const paid = `${formatPrice(p.from_cents)}/mo`;
    return p.free_plan ? `Free · ${paid}` : paid;
  }
  if (p.free_plan) return 'Free';
  return null;
}

/** "Shopify App Store, checked 17 Nov 2026" (rating/price tooltip and source lines). */
export function appStoreSource(checkedOn: string | null | undefined): string {
  return checkedOn ? `Shopify App Store, checked ${formatDate(checkedOn)}` : 'Shopify App Store listing';
}

/** "221 of 930 scanned stores" */
export function usageLine(u: UsageStat): string {
  return `${u.stores.toLocaleString('en-US')} of ${u.denominator.toLocaleString('en-US')} scanned stores`;
}

/** Store viewer URL anchored at a section: /stores/<domain>?page=product&device=mobile#section-504 */
export function sectionViewerHref(s: Pick<SectionCard, 'id' | 'page_type' | 'device' | 'store'>): string {
  const q = new URLSearchParams({ page: s.page_type, device: s.device });
  return `${s.store.href}?${q.toString()}#section-${s.id}`;
}

const PAGE_NAMES: Record<string, string> = {
  home: 'Home',
  collection: 'Collection',
  product: 'Product',
  cart: 'Cart',
  search: 'Search',
  blog: 'Blog',
  article: 'Article',
  page: 'Page',
  'not-found': '404',
};
export const pageName = (slug: string) => PAGE_NAMES[slug] ?? slug;

/**
 * Builds hrefs for a list page from the current URL: `withParams({ category: 'reviews', p: null })`
 * keeps the other params, drops nulls and the page number by default.
 */
export function urlWith(url: URL, changes: Record<string, string | null | undefined>, keepPage = false): string {
  const next = new URLSearchParams(url.searchParams);
  if (!keepPage) next.delete('p');
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/** Positive integer from a query param (page numbers), else the fallback. */
export function intParam(value: string | null, fallback = 1, max = 10_000): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/** BreadcrumbList JSON-LD from crumbs with site paths. */
export function breadcrumbLd(base: URL | string, items: Array<{ label: string; href: string }>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      item: new URL(item.href, base).href,
    })),
  };
}

/**
 * Collects `size` rows starting at `offset` from a cursor-paginated list, fetching at most 100 per
 * call. Lists only expose opaque cursors, so deep pages walk forward from the start.
 */
export async function sliceFromCursorList<T>(
  fetchPage: (limit: number, cursor?: string) => Promise<{ items: T[]; next: string | null; total: number | null }>,
  offset: number,
  size: number,
): Promise<{ items: T[]; total: number | null }> {
  const want = offset + size;
  const rows: T[] = [];
  let cursor: string | undefined;
  let total: number | null = null;
  while (rows.length < want) {
    const page = await fetchPage(Math.min(100, want - rows.length), cursor);
    total = page.total ?? total;
    rows.push(...page.items);
    if (!page.next || page.items.length === 0) break;
    cursor = page.next;
  }
  return { items: rows.slice(offset, want), total };
}
