/** Admin sections: labels, icons and routes shared by the sidebar, the mobile bar and pages. */
import type { IconName } from '~/components/ui/icons';

export type AdminSection =
  'overview' | 'stores' | 'themes' | 'apps' | 'removals' | 'scans' | 'teardowns' | 'affiliates';

/** Sidebar counts (one query in AdminLayout). */
export interface NavCounts {
  removals: number;
  jobs: number;
  stores: number;
  themes: number;
  apps: number;
  links: number;
  teardowns: number;
}

export const SECTION_LABELS: Record<AdminSection, string> = {
  overview: 'Overview',
  removals: 'Removals',
  stores: 'Stores',
  themes: 'Themes',
  apps: 'Apps',
  affiliates: 'Affiliates',
  teardowns: 'Teardowns',
  scans: 'Scans',
};

export const SECTION_ICONS: Record<AdminSection, IconName> = {
  overview: 'house',
  removals: 'flag',
  stores: 'storefront',
  themes: 'paint-brush',
  apps: 'puzzle-piece',
  affiliates: 'link-simple',
  teardowns: 'article',
  scans: 'arrow-clockwise',
};

export const SECTION_HREFS: Record<AdminSection, string> = {
  overview: '/admin',
  removals: '/admin/removals',
  stores: '/admin/stores',
  themes: '/admin/themes',
  apps: '/admin/apps',
  affiliates: '/admin/affiliates',
  teardowns: '/admin/teardowns',
  scans: '/admin/scans',
};
