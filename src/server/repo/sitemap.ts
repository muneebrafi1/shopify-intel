/**
 * XML sitemap builders. Every URL listed here must be canonical, public and indexable (never
 * noindex, never opted-out/inactive, never query-filtered). Queries stay well inside D1's free
 * 50-statement request limit.
 */
import { PRO_ENABLED } from '../../config/flags.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { Db } from '../db/types.ts';

interface SitemapUrl {
  path: string;
  lastmod?: string;
}

const STATIC_PATHS = [
  '/',
  '/stores',
  '/themes',
  '/apps',
  '/apps/categories',
  '/sections',
  '/teardowns',
  '/compare',
  '/alternatives',
  '/about',
  '/methodology',
  '/developers',
  '/affiliate-disclosure',
  '/privacy',
  '/terms',
  '/opt-out',
] as const;

const xmlEscape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const isoDay = (value: string | null | undefined): string | undefined =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;

const renderUrlSet = (origin: string, entries: readonly SitemapUrl[]): string => {
  const base = origin.replace(/\/$/, '');
  const seen = new Set<string>();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    const loc = xmlEscape(`${base}${entry.path}`);
    lines.push(
      entry.lastmod
        ? `  <url><loc>${loc}</loc><lastmod>${xmlEscape(entry.lastmod)}</lastmod></url>`
        : `  <url><loc>${loc}</loc></url>`,
    );
  }
  lines.push('</urlset>', '');
  return lines.join('\n');
};

export async function buildSitemapIndex(db: Db, origin: string): Promise<string> {
  const base = origin.replace(/\/$/, '');
  const row = await db.first<{ value: string }>(
    "SELECT MAX(substr(value, 1, 10)) AS value FROM meta WHERE key IN ('data_as_of', 'crawl_last_at')",
  );
  const lastmod = isoDay(row?.value);
  const tag = lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <sitemap><loc>${xmlEscape(`${base}/sitemaps/core.xml`)}</loc>${tag}</sitemap>`,
    `  <sitemap><loc>${xmlEscape(`${base}/sitemaps/sections.xml`)}</loc>${tag}</sitemap>`,
    '</sitemapindex>',
    '',
  ].join('\n');
}

export async function buildCoreSitemap(db: Db, origin: string): Promise<string> {
  const [
    metaRow,
    stores,
    themes,
    apps,
    categories,
    sectionTypes,
    teardowns,
    comparisons,
    altApps,
    altThemes,
    niches,
    themeGalleries,
  ] = await Promise.all([
    db.first<{ value: string }>(
      "SELECT MAX(substr(value, 1, 10)) AS value FROM meta WHERE key IN ('data_as_of', 'crawl_last_at')",
    ),
    db.all<{ domain: string; last_seen: string }>(
      `SELECT domain, last_seen FROM stores
       WHERE status = 'active'
         AND EXISTS (SELECT 1 FROM screenshots sh WHERE sh.store_id = stores.id AND sh.is_current = 1)
       ORDER BY tranco_rank IS NULL, tranco_rank, domain`,
    ),
    db.all<{ slug: string }>("SELECT slug FROM themes WHERE status = 'active' ORDER BY slug"),
    db.all<{ slug: string; checked_on: string | null }>(
      "SELECT slug, checked_on FROM apps WHERE status = 'active' ORDER BY slug",
    ),
    db.all<{ slug: string }>(
      `SELECT ac.slug FROM app_categories ac
       WHERE EXISTS (SELECT 1 FROM apps a WHERE a.category_id = ac.id AND a.status = 'active')
       ORDER BY ac.slug`,
    ),
    db.all<{ slug: string }>(
      `SELECT DISTINCT s.section_type AS slug FROM sections s
       JOIN screenshots sh ON sh.id = s.screenshot_id AND sh.is_current = 1
       JOIN stores st ON st.id = s.store_id AND st.status = 'active'
       ORDER BY s.section_type`,
    ),
    db.all<{ slug: string; published_at: string }>(
      'SELECT slug, published_at FROM teardowns WHERE published_at IS NOT NULL ORDER BY published_at DESC, slug',
    ),
    db.all<{ slug: string }>('SELECT slug FROM comparisons ORDER BY position, id'),
    db.all<{ slug: string }>(
      `SELECT a.slug FROM apps a
       LEFT JOIN app_stats st ON st.app_id = a.id
       WHERE a.status = 'active' AND COALESCE(st.store_count, 0) > 0
         AND EXISTS (
           SELECT 1 FROM apps o
           WHERE o.category_id = a.category_id AND o.id <> a.id AND o.status = 'active'
         )
       ORDER BY a.slug`,
    ),
    db.all<{ slug: string }>(
      `SELECT t.slug FROM themes t
       WHERE t.status = 'active'
         AND EXISTS (
           SELECT 1 FROM themes o
           WHERE o.id <> t.id AND o.status = 'active'
             AND (
               o.vendor_slug = t.vendor_slug
               OR o.price_cents = t.price_cents
               OR (
                 o.price_cents > 0 AND t.price_cents > 0
                 AND abs(o.price_cents - t.price_cents) <= 0.2 * max(o.price_cents, t.price_cents)
               )
             )
         )
       ORDER BY t.slug`,
    ),
    // Niche and theme galleries (curated, captured stores only: a gallery needs pictures).
    db.all<{ slug: string }>(
      `SELECT sc.slug FROM store_categories sc
       WHERE EXISTS (
         SELECT 1 FROM stores st
         WHERE st.category_slug = sc.slug AND st.is_curated = 1 AND st.is_captured = 1 AND st.status = 'active'
       )
       ORDER BY sc.slug`,
    ),
    db.all<{ slug: string }>(
      `SELECT t.slug FROM themes t
       WHERE t.status = 'active'
         AND EXISTS (
           SELECT 1 FROM stores st
           WHERE st.current_theme_id = t.id AND st.is_curated = 1 AND st.is_captured = 1
             AND st.status = 'active'
         )
       ORDER BY t.slug`,
    ),
  ]);

  const dataDay = isoDay(metaRow?.value);
  const entries: SitemapUrl[] = [
    ...[...STATIC_PATHS, ...(PRO_ENABLED ? ['/pro'] : [])].map((path) => ({
      path,
      lastmod: dataDay,
    })),
    ...stores.map((s) => ({
      path: hrefs.store(s.domain),
      lastmod: isoDay(s.last_seen) ?? dataDay,
    })),
    ...themes.map((t) => ({ path: hrefs.theme(t.slug), lastmod: dataDay })),
    ...niches.map((n) => ({ path: hrefs.storeCategory(n.slug), lastmod: dataDay })),
    ...themeGalleries.map((t) => ({ path: `${hrefs.theme(t.slug)}/stores`, lastmod: dataDay })),
    ...apps.map((a) => ({
      path: hrefs.app(a.slug),
      lastmod: isoDay(a.checked_on) ?? dataDay,
    })),
    ...categories.map((c) => ({ path: hrefs.appCategory(c.slug), lastmod: dataDay })),
    ...sectionTypes.map((st) => ({ path: hrefs.sectionType(st.slug), lastmod: dataDay })),
    ...teardowns.map((t) => ({
      path: hrefs.teardown(t.slug),
      lastmod: isoDay(t.published_at) ?? dataDay,
    })),
    ...comparisons.map((c) => ({ path: hrefs.compare(c.slug), lastmod: dataDay })),
    ...altApps.map((a) => ({ path: hrefs.alternatives(a.slug), lastmod: dataDay })),
    ...altThemes.map((t) => ({ path: hrefs.alternatives(t.slug), lastmod: dataDay })),
  ];
  return renderUrlSet(origin, entries);
}

export async function buildSectionsSitemap(db: Db, origin: string): Promise<string> {
  const rows = await db.all<{ id: number; section_type: string; lastmod: string | null }>(
    `SELECT s.id, s.section_type, COALESCE(sh.captured_at, st.last_seen) AS lastmod
     FROM sections s
     JOIN screenshots sh ON sh.id = s.screenshot_id AND sh.is_current = 1
     JOIN stores st ON st.id = s.store_id AND st.status = 'active'
     ORDER BY s.id`,
  );
  return renderUrlSet(
    origin,
    rows.map((r) => ({
      path: hrefs.section(r.section_type, r.id),
      lastmod: isoDay(r.lastmod),
    })),
  );
}
