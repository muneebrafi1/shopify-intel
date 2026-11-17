/**
 * Brand + site-wide constants. The brand is not decided yet: change SITE_NAME here and
 * nowhere else. Never hard-code the brand name in components, copy or tests.
 */
export const SITE_NAME = 'Vitrine';

/** Short descriptor used next to the name in titles and meta. */
export const SITE_TAGLINE = 'Real Shopify stores, page by page';

/** Legal entity that operates the site (footer copyright line, legal pages). */
export const LEGAL_ENTITY = 'Xovist';

/** Production domain (placeholder until the brand is chosen). Used for canonicals and sitemaps. */
export const SITE_DOMAIN = 'vitrine.example';
export const SITE_URL = `https://${SITE_DOMAIN}`;

/** Public contact addresses are role-based placeholders, not personal emails. */
export const CONTACT = {
  removals: `removals@${SITE_DOMAIN}`,
  hello: `hello@${SITE_DOMAIN}`,
} as const;

/** Primary navigation. Order matters: it is the order in the header. */
export const PRIMARY_NAV = [
  { href: '/stores', label: 'Stores' },
  { href: '/themes', label: 'Themes' },
  { href: '/apps', label: 'Apps' },
  { href: '/sections', label: 'Sections' },
  { href: '/teardowns', label: 'Teardowns' },
  { href: '/compare', label: 'Compare' },
] as const;

export const API_VERSION = 'v1';

/**
 * While store screenshots are drawn placeholders (no capture run yet), a slim notice explains
 * it on every page. Set to false once real captures are live.
 */
export const SHOW_CAPTURE_PREVIEW_NOTICE = true;
