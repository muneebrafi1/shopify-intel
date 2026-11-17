/**
 * Shared logic for the sections library pages (/sections and /sections/<type>): reading filter
 * params from the URL, building filter links that keep the other params, and turning the API's
 * facets into the contents rail and the filter bar. Filters are URL state, so everything here
 * produces plain hrefs that work without JavaScript.
 */
import type { FilterGroup } from '~/components/ui/FilterBar.astro';
import { formatDate } from '~/lib/format';
import {
  DEVICES,
  PAGE_TYPES,
  SECTION_GROUPS,
  SECTION_TYPES,
  pageTypeName,
  type Device,
  type PageType,
  type SectionType,
} from '~/lib/taxonomy';
import type { Facet, ListSectionsOutput, ResponseMeta, SectionCard } from '~/server/api/v1/types';

export const PAGE_SIZE = 24;

export interface LibraryFilters {
  page?: PageType | undefined;
  device?: Device | undefined;
  theme?: string | undefined;
  app?: string | undefined;
}

const PAGE_SLUGS = PAGE_TYPES.map((p) => p.slug) as readonly string[];
const DEVICE_SLUGS = DEVICES.map((d) => d.slug) as readonly string[];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

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
  return {
    page: page && PAGE_SLUGS.includes(page) ? (page as PageType) : undefined,
    device: device && DEVICE_SLUGS.includes(device) ? (device as Device) : undefined,
    theme: theme && SLUG_RE.test(theme) ? theme : undefined,
    app: app && SLUG_RE.test(app) ? app : undefined,
  };
}

export const activeFilterCount = (f: LibraryFilters) =>
  [f.page, f.device, f.theme, f.app].filter(Boolean).length;

/** `?page=…&device=…` in a stable order (or '' when nothing is set). */
export function filterQuery(f: LibraryFilters, extra: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  if (f.page) q.set('page', f.page);
  if (f.device) q.set('device', f.device);
  if (f.theme) q.set('theme', f.theme);
  if (f.app) q.set('app', f.app);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Library URL for a type (or all types) with the given filters. */
export const libraryHref = (type: SectionType | null, f: LibraryFilters = {}) =>
  `${type ? `/sections/${type}` : '/sections'}${filterQuery(f)}`;

// ---------------------------------------------------------------------------------------------
// Contents rail
// ---------------------------------------------------------------------------------------------
export interface RailType {
  slug: SectionType;
  name: string;
  count: number;
  href: string;
  current: boolean;
}
export interface RailGroup {
  n: number;
  slug: string;
  name: string;
  count: number;
  types: RailType[];
}
export interface Rail {
  all: { count: number; href: string; current: boolean };
  groups: RailGroup[];
}

/** Book-style contents: every group and type in taxonomy order, counted under the filters. */
export function buildRail(
  typeFacets: Facet[],
  current: SectionType | null,
  f: LibraryFilters,
): Rail {
  const countOf = (slug: string) => typeFacets.find((t) => t.value === slug)?.count ?? 0;
  const groups = SECTION_GROUPS.map((g, i) => {
    const types = SECTION_TYPES.filter((t) => t.group === g.slug).map((t) => ({
      slug: t.slug,
      name: t.name,
      count: countOf(t.slug),
      href: libraryHref(t.slug, f),
      current: t.slug === current,
    }));
    return {
      n: i + 1,
      slug: g.slug,
      name: g.name,
      count: types.reduce((sum, t) => sum + t.count, 0),
      types,
    };
  });
  return {
    all: {
      count: groups.reduce((sum, g) => sum + g.count, 0),
      href: libraryHref(null, f),
      current: current === null,
    },
    groups,
  };
}

// ---------------------------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------------------------
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
  // Keep a selected value visible even when it has no results under the other filters.
  const withSelected = (list: Facet[], value: string | undefined): Facet[] =>
    value && !list.some((x) => x.value === value)
      ? [{ value, label: value, count: 0 }, ...list]
      : list;

  return [
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
      key: 'page',
      label: 'Page',
      options: [
        { label: 'All pages', href: here({ ...f, page: undefined }), selected: !f.page },
        ...withSelected(pageFacets, f.page).map((p) => ({
          label: pageTypeName(p.value),
          href: here({ ...f, page: p.value as PageType }),
          selected: p.value === f.page,
          count: p.count,
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
}

// ---------------------------------------------------------------------------------------------
// Captions and sources
// ---------------------------------------------------------------------------------------------
/** Contact-sheet caption facts, e.g. "Reviews · Product · Prestige". */
export function cardMeta(s: SectionCard, parts: Array<'type' | 'page' | 'device' | 'theme'>) {
  return parts
    .map((p) => {
      if (p === 'type') return s.type.name;
      if (p === 'page') return pageTypeName(s.page_type);
      if (p === 'device') return s.device === 'mobile' ? 'Mobile' : 'Desktop';
      return s.theme?.name ?? 'Custom theme';
    })
    .join(' · ');
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
  const name = pageTypeName(page);
  const noun = /page$/i.test(name) ? name : `${name} page`;
  return `${noun.charAt(0).toLowerCase()}${noun.slice(1)}, ${device}`;
}
