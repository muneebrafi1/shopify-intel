/**
 * Shared logic for the sections library pages (/sections and /sections/<type>): reading filter
 * params from the URL, building links that keep the other params, turning the API's facets into
 * the browse bar, the device switch and the sort menu, and resolving the search box to a filter.
 * Filters are URL state, so everything here produces plain hrefs that work without JavaScript.
 */
import type { FilterGroup, SortOption } from '~/components/ui/BrowseBar.astro';
import type { SegmentedItem } from '~/components/ui/Segmented.astro';
import { formatDate } from '~/lib/format';
import {
  DEVICES,
  PAGE_TYPES,
  SECTION_TYPES,
  pageTypeName,
  type Device,
  type PageType,
  type SectionType,
} from '~/lib/taxonomy';
import { api } from '~/server/api';
import type { Facet, ListSectionsOutput, ResponseMeta, SectionCard } from '~/server/api/v1/types';

export const PAGE_SIZE = 24;

export interface LibraryFilters {
  page?: PageType | undefined;
  device?: Device | undefined;
  theme?: string | undefined;
  app?: string | undefined;
  /** Store domain (set from the search box; the API's `store` filter). */
  store?: string | undefined;
  /** 'store' = the API's ingest order (a store's pages section by section). Default: mixed. */
  sort?: 'store' | undefined;
  /** Display mode, kept across filter links (not a filter). */
  view?: 'index' | undefined;
}

const PAGE_SLUGS = PAGE_TYPES.map((p) => p.slug) as readonly string[];
const DEVICE_SLUGS = DEVICES.map((d) => d.slug) as readonly string[];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/;

export const isSectionType = (slug: string | undefined): slug is SectionType =>
  !!slug && SECTION_TYPES.some((t) => t.slug === slug);

/** Reads the filter params. Unknown page types/devices and malformed slugs are ignored. */
export function readFilters(url: URL): LibraryFilters {
  const q = url.searchParams;
  const pick = (key: string) => q.get(key)?.trim().toLowerCase() || undefined;
  const page = pick('page');
  const device = pick('device');
  const theme = pick('theme');
  const app = pick('app');
  const store = pick('store');
  return {
    page: page && PAGE_SLUGS.includes(page) ? (page as PageType) : undefined,
    device: device && DEVICE_SLUGS.includes(device) ? (device as Device) : undefined,
    theme: theme && SLUG_RE.test(theme) ? theme : undefined,
    app: app && SLUG_RE.test(app) ? app : undefined,
    store: store && DOMAIN_RE.test(store) ? store : undefined,
    sort: q.get('sort') === 'store' ? 'store' : undefined,
    view: q.get('view') === 'index' ? 'index' : undefined,
  };
}

/** Filters that narrow the results (sort and view don't). */
export const activeFilterCount = (f: LibraryFilters) =>
  [f.page, f.device, f.theme, f.app, f.store].filter(Boolean).length;

/** `?page=…&device=…` in a stable order (or '' when nothing is set). */
export function filterQuery(f: LibraryFilters, extra: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  if (f.page) q.set('page', f.page);
  if (f.device) q.set('device', f.device);
  if (f.theme) q.set('theme', f.theme);
  if (f.app) q.set('app', f.app);
  if (f.store) q.set('store', f.store);
  if (f.sort) q.set('sort', f.sort);
  if (f.view) q.set('view', f.view);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Library URL for a type (or all types) with the given filters (and sort/view). */
export const libraryHref = (type: SectionType | null, f: LibraryFilters = {}) =>
  `${type ? `/sections/${type}` : '/sections'}${filterQuery(f)}`;

/** The API's sort for the library's `sort` param. */
export const apiSort = (f: LibraryFilters) => (f.sort === 'store' ? 'id' : 'mixed');

// ---------------------------------------------------------------------------------------------
// Browse bar
// ---------------------------------------------------------------------------------------------
/** Keep a selected value visible even when it has no results under the other filters. */
const withSelected = (list: Facet[], value: string | undefined, label?: string): Facet[] =>
  value && !list.some((x) => x.value === value)
    ? [{ value, label: label ?? value, count: 0 }, ...list]
    : list;

/**
 * Browse-bar groups: the section types (shown as the pill row), device (lives in the header
 * switch on wide screens, in the Filters sheet below 1024), page, theme, app, and the store
 * when one was picked through search.
 */
export function buildFilterGroups(
  facets: ListSectionsOutput['facets'],
  type: SectionType | null,
  f: LibraryFilters,
): FilterGroup[] {
  const here = (next: LibraryFilters) => libraryHref(type, next);
  const typeTotal = facets.types.reduce((sum, t) => sum + t.count, 0);
  const pageFacets = [...facets.page_types].sort(
    (a, b) => PAGE_SLUGS.indexOf(a.value) - PAGE_SLUGS.indexOf(b.value),
  );

  const groups: FilterGroup[] = [
    {
      key: 'type',
      label: 'Type',
      options: [
        { label: 'All types', href: libraryHref(null, f), selected: !type, count: typeTotal },
        ...SECTION_TYPES.filter(
          (t) => t.slug === type || facets.types.some((x) => x.value === t.slug),
        ).map((t) => ({
          label: t.name,
          href: libraryHref(t.slug, f),
          selected: t.slug === type,
          count: facets.types.find((x) => x.value === t.slug)?.count ?? 0,
        })),
      ],
    },
    {
      key: 'device',
      label: 'Device',
      options: [
        { label: 'Any device', href: here({ ...f, device: undefined }), selected: !f.device },
        ...withSelected(facets.devices, f.device).map((d) => ({
          label: d.label === d.value ? d.value : d.label,
          href: here({ ...f, device: d.value as Device }),
          selected: d.value === f.device,
          count: d.count,
        })),
      ],
    },
    {
      key: 'page',
      label: 'Page',
      options: [
        { label: 'All pages', href: here({ ...f, page: undefined }), selected: !f.page },
        ...withSelected(pageFacets, f.page, f.page && pageTypeName(f.page)).map((p) => ({
          label: pageTypeName(p.value),
          href: here({ ...f, page: p.value as PageType }),
          selected: p.value === f.page,
          count: p.count,
        })),
      ],
    },
    {
      key: 'theme',
      label: 'Theme',
      options: [
        { label: 'All themes', href: here({ ...f, theme: undefined }), selected: !f.theme },
        ...withSelected(facets.themes, f.theme).map((t) => ({
          label: t.label,
          href: here({ ...f, theme: t.value }),
          selected: t.value === f.theme,
          count: t.count,
        })),
      ],
    },
    {
      key: 'app',
      label: 'App',
      options: [
        { label: 'All apps', href: here({ ...f, app: undefined }), selected: !f.app },
        ...withSelected(facets.apps, f.app).map((a) => ({
          label: a.label,
          href: here({ ...f, app: a.value }),
          selected: a.value === f.app,
          count: a.count,
        })),
      ],
    },
  ];
  if (f.store) {
    groups.push({
      key: 'store',
      label: 'Store',
      options: [
        { label: 'All stores', href: here({ ...f, store: undefined }), selected: false },
        { label: f.store, href: here(f), selected: true },
      ],
    });
  }
  return groups;
}

/** Sort menu: mixed (the API's library order) or a store's pages section by section. */
export function buildSort(type: SectionType | null, f: LibraryFilters): SortOption[] {
  return [
    { label: 'Mixed', href: libraryHref(type, { ...f, sort: undefined }), selected: !f.sort },
    {
      label: 'By store',
      href: libraryHref(type, { ...f, sort: 'store' }),
      selected: f.sort === 'store',
    },
  ];
}

/** Desktop / Mobile switch with counts under the other filters (links, URL state). */
export function deviceItems(
  devices: Facet[],
  type: SectionType | null,
  f: LibraryFilters,
): SegmentedItem[] {
  const count = (d: string) => devices.find((x) => x.value === d)?.count ?? 0;
  return [
    {
      label: 'All',
      value: 'all',
      href: libraryHref(type, { ...f, device: undefined }),
      selected: !f.device,
      count: count('desktop') + count('mobile'),
    },
    {
      label: 'Desktop',
      value: 'desktop',
      icon: 'desktop',
      href: libraryHref(type, { ...f, device: 'desktop' }),
      selected: f.device === 'desktop',
      count: count('desktop'),
    },
    {
      label: 'Mobile',
      value: 'mobile',
      icon: 'device-mobile',
      href: libraryHref(type, { ...f, device: 'mobile' }),
      selected: f.device === 'mobile',
      count: count('mobile'),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Search box
// ---------------------------------------------------------------------------------------------
/**
 * The library has no free-text index, so the search box resolves a query to the closest filter:
 * a section type first, then a theme, an app, a store (site search does the fuzzy matching).
 * Returns the URL to redirect to, or null when nothing matches.
 */
export async function resolveSearch(
  q: string,
  type: SectionType | null,
  f: LibraryFilters,
): Promise<string | null> {
  const query = q.trim().slice(0, 100);
  if (!query) return null;
  let groups;
  try {
    ({
      data: { groups },
    } = await api.search({ q: query, kinds: ['section-type', 'theme', 'app', 'store'], limit: 1 }));
  } catch {
    return null;
  }
  const first = (kind: string) => groups.find((g) => g.kind === kind)?.items[0];
  const next = { ...f };
  const typeHit = first('section-type');
  if (typeHit && isSectionType(typeHit.ref)) return libraryHref(typeHit.ref, next);
  const theme = first('theme');
  if (theme) return libraryHref(type, { ...next, theme: theme.ref });
  const app = first('app');
  if (app) return libraryHref(type, { ...next, app: app.ref });
  const store = first('store');
  if (store && DOMAIN_RE.test(store.ref)) return libraryHref(type, { ...next, store: store.ref });
  return null;
}

// ---------------------------------------------------------------------------------------------
// Captions and sources
// ---------------------------------------------------------------------------------------------
/** "Product page", "Content page", "404 page". */
export function pageLabel(page: string) {
  const name = pageTypeName(page);
  return /page$/i.test(name) ? name : `${name} page`;
}

/** Where the crops come from, for the source line under counts. */
export function cropSource(meta: ResponseMeta, items: SectionCard[]) {
  const planned = items.length === 0 || items.some((s) => s.is_placeholder);
  const plan = meta.sources['capture-plan'];
  return {
    label: planned ? 'Planned capture layouts (previews, not screenshots)' : 'Our page captures',
    asOf: formatDate((planned ? plan?.as_of : null) ?? meta.data_as_of),
  };
}

/** Page-type/device phrase: "home page, desktop" / "content page, mobile". */
export function pagePhrase(page: string, device: string) {
  const noun = pageLabel(page);
  return `${noun.charAt(0).toLowerCase()}${noun.slice(1)}, ${device}`;
}

export const fmt = (n: number) => n.toLocaleString('en-US');
