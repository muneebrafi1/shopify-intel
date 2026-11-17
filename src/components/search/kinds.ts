/**
 * Search result kinds: page order, labels, the index each one belongs to, the row action and the
 * glyph used when a hit has no picture. Shared by /search and its result rows.
 */
import type { IconName } from '~/components/ui/icons';
import type { SearchKind } from '~/server/api/v1/types';

export interface KindInfo {
  one: string;
  many: string;
  /** Tab label (short). */
  tab: string;
  href: string;
  all: string;
  action: string;
  icon: IconName;
}

export const KIND: Record<SearchKind, KindInfo> = {
  store: {
    one: 'Store',
    many: 'Stores',
    tab: 'Stores',
    href: '/stores',
    all: 'All stores',
    action: 'Open store',
    icon: 'storefront',
  },
  theme: {
    one: 'Theme',
    many: 'Themes',
    tab: 'Themes',
    href: '/themes',
    all: 'All themes',
    action: 'View theme',
    icon: 'paint-brush',
  },
  app: {
    one: 'App',
    many: 'Apps',
    tab: 'Apps',
    href: '/apps',
    all: 'All apps',
    action: 'View app',
    icon: 'puzzle-piece',
  },
  'app-category': {
    one: 'Category',
    many: 'App categories',
    tab: 'Categories',
    href: '/apps/categories',
    all: 'All categories',
    action: 'Browse category',
    icon: 'squares-four',
  },
  'section-type': {
    one: 'Section',
    many: 'Section types',
    tab: 'Sections',
    href: '/sections',
    all: 'Sections library',
    action: 'See sections',
    icon: 'stack',
  },
  vendor: {
    one: 'Vendor',
    many: 'Theme vendors',
    tab: 'Vendors',
    href: '/themes',
    all: 'All themes',
    action: 'See themes',
    icon: 'tag-simple',
  },
  teardown: {
    one: 'Teardown',
    many: 'Teardowns',
    tab: 'Teardowns',
    href: '/teardowns',
    all: 'All teardowns',
    action: 'Read',
    icon: 'article',
  },
};

/** Page and tab order: the things people search for most first. */
export const ORDER: SearchKind[] = [
  'store',
  'theme',
  'app',
  'app-category',
  'section-type',
  'vendor',
  'teardown',
];

export const isKind = (value: string | null): value is SearchKind =>
  !!value && (ORDER as string[]).includes(value);

/** A short query for a popular pick: "Klaviyo: Email Marketing & SMS" → "Klaviyo". */
export function shortQuery(title: string): string {
  const head = title.split(/\s*[:|(‑–—]\s*|\s+-\s+/)[0]!.trim();
  if (head.length <= 18) return head;
  return head.split(/\s+/)[0]!;
}
