/**
 * Site paths the API hands out as `href`. One place to change if page routes move.
 * (SEO-clean URLs from docs/BRIEF.md.)
 */
export const hrefs = {
  store: (domain: string) => `/stores/${domain}`,
  theme: (slug: string) => `/themes/${slug}`,
  themeVendor: (vendorSlug: string) => `/themes?vendor=${encodeURIComponent(vendorSlug)}`,
  app: (slug: string) => `/apps/${slug}`,
  appCategory: (slug: string) => `/apps/categories/${slug}`,
  compare: (pairSlug: string) => `/compare/${pairSlug}`,
  alternatives: (slug: string) => `/alternatives/${slug}`,
  teardown: (slug: string) => `/teardowns/${slug}`,
  sectionType: (slug: string) => `/sections/${slug}`,
  section: (type: string, id: number) => `/sections/${type}/${id}`,
  storeCategory: (slug: string) => `/stores?category=${encodeURIComponent(slug)}`,
  go: (linkId: number) => `/go/${linkId}`,
} as const;
