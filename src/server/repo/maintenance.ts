import type { Db } from '../db/types.ts';

/**
 * Rebuilds every derived table (store current-state columns, summary tables, similar stores and
 * the search index) from the source-of-truth tables. Pure SQL with no parameters so the seed
 * builder can append the same statements to the generated seed file, and ingest / admin code
 * (e.g. after an opt-out) can run them through `rebuildDerived(db)`.
 *
 * Cost note: everything here is a full rebuild. That is fine for thousands of stores; at 50K+
 * the co-install and similar-store self-joins should move to the offline ingest job (or be
 * rebuilt incrementally per changed store). See docs/API.md.
 */

const AS_OF = `(SELECT value FROM meta WHERE key = 'data_as_of')`;

/** Current theme, app count and capture flag on `stores`, then the default list order. */
const STORE_STATE = [
  `UPDATE stores SET
    current_theme_id = (SELECT st.theme_id FROM store_themes st WHERE st.store_id = stores.id AND st.replaced_at IS NULL),
    current_theme_name = (SELECT st.raw_name FROM store_themes st WHERE st.store_id = stores.id AND st.replaced_at IS NULL),
    current_theme_version = (SELECT st.version FROM store_themes st WHERE st.store_id = stores.id AND st.replaced_at IS NULL),
    current_theme_is_custom = COALESCE((SELECT st.is_custom FROM store_themes st WHERE st.store_id = stores.id AND st.replaced_at IS NULL), 0),
    app_count = (SELECT COUNT(*) FROM store_apps sa WHERE sa.store_id = stores.id AND sa.removed_at IS NULL)
      + (SELECT COUNT(*) FROM store_unresolved_apps su WHERE su.store_id = stores.id AND su.removed_at IS NULL),
    is_captured = EXISTS (SELECT 1 FROM screenshots s WHERE s.store_id = stores.id AND s.is_current = 1 AND s.is_placeholder = 0)`,
  // Default "rank" order: Tranco-ranked stores first, then curated, then richer app stacks.
  `UPDATE stores SET list_position = r.pos FROM (
    SELECT id, ROW_NUMBER() OVER (
      ORDER BY tranco_rank IS NULL, tranco_rank, is_curated DESC, app_count DESC, domain
    ) AS pos FROM stores
  ) AS r WHERE r.id = stores.id`,
];

/**
 * Ranks are standard competition ranks ("1224"): equal usage shares a rank and the next rank
 * skips (SQL RANK()). Only public (active) apps and themes take part, so hiding one never leaves
 * a gap; hidden ones are ranked among themselves and never shown. Display order for ties is the
 * name (see the list queries); the rank itself never depends on it.
 */
const APP_STATS = [
  `DELETE FROM app_stats`,
  `INSERT INTO app_stats (app_id, store_count, curated_store_count, denominator, section_count, rank_overall, rank_in_category, as_of)
  WITH active AS (SELECT id, is_curated FROM stores WHERE status = 'active'),
  counts AS (
    SELECT a.id AS app_id, a.category_id AS category_id, a.status = 'active' AS listed,
      COUNT(act.id) AS store_count,
      COALESCE(SUM(act.is_curated), 0) AS curated_store_count
    FROM apps a
    LEFT JOIN store_apps sa ON sa.app_id = a.id AND sa.removed_at IS NULL
    LEFT JOIN active act ON act.id = sa.store_id
    GROUP BY a.id
  ),
  secs AS (
    SELECT app_id, COUNT(*) AS n FROM sections
    WHERE app_id IS NOT NULL AND is_current = 1 AND store_id IN (SELECT id FROM active)
    GROUP BY app_id
  )
  SELECT c.app_id, c.store_count, c.curated_store_count, (SELECT COUNT(*) FROM active),
    COALESCE(secs.n, 0),
    RANK() OVER (PARTITION BY c.listed ORDER BY c.store_count DESC),
    RANK() OVER (PARTITION BY c.listed, c.category_id ORDER BY c.store_count DESC),
    ${AS_OF}
  FROM counts c LEFT JOIN secs ON secs.app_id = c.app_id`,
];

const THEME_STATS = [
  `DELETE FROM theme_stats`,
  `INSERT INTO theme_stats (theme_id, store_count, curated_store_count, denominator, section_count, screenshot_count, avg_app_count, rank_overall, as_of)
  WITH active AS (SELECT * FROM stores WHERE status = 'active'),
  counts AS (
    SELECT t.id AS theme_id, t.status = 'active' AS listed,
      COUNT(s.id) AS store_count, COALESCE(SUM(s.is_curated), 0) AS curated_store_count,
      AVG(s.app_count) AS avg_app_count
    FROM themes t LEFT JOIN active s ON s.current_theme_id = t.id
    GROUP BY t.id
  ),
  secs AS (
    SELECT theme_id, COUNT(*) AS n FROM sections
    WHERE theme_id IS NOT NULL AND is_current = 1 AND store_id IN (SELECT id FROM active)
    GROUP BY theme_id
  ),
  shots AS (
    SELECT theme_id, COUNT(*) AS n FROM screenshots
    WHERE theme_id IS NOT NULL AND is_current = 1 AND store_id IN (SELECT id FROM active)
    GROUP BY theme_id
  )
  SELECT c.theme_id, c.store_count, c.curated_store_count, (SELECT COUNT(*) FROM active),
    COALESCE(secs.n, 0), COALESCE(shots.n, 0), c.avg_app_count,
    RANK() OVER (PARTITION BY c.listed ORDER BY c.store_count DESC),
    ${AS_OF}
  FROM counts c
  LEFT JOIN secs ON secs.theme_id = c.theme_id
  LEFT JOIN shots ON shots.theme_id = c.theme_id`,
];

const CO_INSTALLS = [
  `DELETE FROM app_co_installs`,
  `INSERT INTO app_co_installs (app_id, other_app_id, store_count)
  SELECT a.app_id, b.app_id, COUNT(*)
  FROM store_apps a
  JOIN store_apps b ON b.store_id = a.store_id AND b.app_id <> a.app_id AND b.removed_at IS NULL
  JOIN stores s ON s.id = a.store_id AND s.status = 'active'
  WHERE a.removed_at IS NULL
  GROUP BY a.app_id, b.app_id`,
];

const THEME_APP_USAGE = [
  `DELETE FROM theme_app_usage`,
  `INSERT INTO theme_app_usage (theme_id, app_id, store_count)
  SELECT s.current_theme_id, sa.app_id, COUNT(*)
  FROM stores s
  JOIN store_apps sa ON sa.store_id = s.id AND sa.removed_at IS NULL
  WHERE s.status = 'active' AND s.current_theme_id IS NOT NULL
  GROUP BY s.current_theme_id, sa.app_id`,
];

/**
 * Up to 8 similar stores per store. Score = shared apps + 3 if the same (non-custom) theme.
 * Pairs need a score of at least 2 (one shared app alone is not similarity).
 */
const STORE_SIMILAR = [
  `DELETE FROM store_similar`,
  `INSERT INTO store_similar (store_id, other_store_id, same_theme, shared_apps, score)
  WITH active AS (
    SELECT id, list_position, lower(current_theme_name) AS theme_key FROM stores
    WHERE status = 'active'
  ),
  shared AS (
    SELECT a.store_id AS store_id, b.store_id AS other_store_id, COUNT(*) AS shared_apps
    FROM store_apps a
    JOIN store_apps b ON b.app_id = a.app_id AND b.store_id <> a.store_id AND b.removed_at IS NULL
    WHERE a.removed_at IS NULL
    GROUP BY a.store_id, b.store_id
  ),
  same_theme AS (
    SELECT x.id AS store_id, y.id AS other_store_id
    FROM active x JOIN active y ON y.theme_key = x.theme_key AND y.id <> x.id
    WHERE x.theme_key IS NOT NULL
  ),
  pairs AS (
    SELECT store_id, other_store_id, MAX(same_theme) AS same_theme, MAX(shared_apps) AS shared_apps
    FROM (
      SELECT store_id, other_store_id, 0 AS same_theme, shared_apps FROM shared
      UNION ALL
      SELECT store_id, other_store_id, 1 AS same_theme, 0 AS shared_apps FROM same_theme
    )
    GROUP BY store_id, other_store_id
  ),
  ranked AS (
    SELECT p.store_id, p.other_store_id, p.same_theme, p.shared_apps,
      p.shared_apps + 3 * p.same_theme AS score,
      ROW_NUMBER() OVER (
        PARTITION BY p.store_id ORDER BY p.shared_apps + 3 * p.same_theme DESC, o.list_position
      ) AS rn
    FROM pairs p
    JOIN active s ON s.id = p.store_id
    JOIN active o ON o.id = p.other_store_id
  )
  SELECT store_id, other_store_id, same_theme, shared_apps, score
  FROM ranked WHERE rn <= 8 AND score >= 2`,
];

const SEARCH_INDEX = [
  `DELETE FROM search_index`,
  `INSERT INTO search_index (kind, ref, title, subtitle, keywords, boost)
  SELECT 'store', s.domain, COALESCE(s.name, s.domain),
    CASE
      WHEN s.current_theme_is_custom = 1 THEN 'Custom theme'
      WHEN s.current_theme_name IS NOT NULL THEN s.current_theme_name || ' theme'
      ELSE 'Theme not detected'
    END || ' · ' || s.app_count || CASE WHEN s.app_count = 1 THEN ' app' ELSE ' apps' END,
    s.domain || ' ' || COALESCE(sc.name, ''),
    s.is_curated * 1000 + s.app_count
  FROM stores s LEFT JOIN store_categories sc ON sc.slug = s.category_slug
  WHERE s.status = 'active'`,
  `INSERT INTO search_index (kind, ref, title, subtitle, keywords, boost)
  SELECT 'theme', t.slug, t.name,
    COALESCE('by ' || t.vendor, 'Theme') || ' · ' || COALESCE(t.price_label, 'Price unknown'),
    COALESCE(t.vendor, '') || ' ' || t.slug,
    COALESCE(ts.store_count, 0)
  FROM themes t LEFT JOIN theme_stats ts ON ts.theme_id = t.id
  WHERE t.status = 'active'`,
  `INSERT INTO search_index (kind, ref, title, subtitle, keywords, boost)
  SELECT 'app', a.slug, a.name,
    COALESCE(a.developer, 'App') || COALESCE(' · ' || c.name, ''),
    a.short_name || ' ' || COALESCE(a.developer, '') || ' ' || COALESCE(c.name, '') || ' ' || a.slug || ' ' || COALESCE(a.app_store_handle, ''),
    COALESCE(st.store_count, 0)
  FROM apps a
  LEFT JOIN app_categories c ON c.id = a.category_id
  LEFT JOIN app_stats st ON st.app_id = a.id
  WHERE a.status = 'active'`,
  `INSERT INTO search_index (kind, ref, title, subtitle, keywords, boost)
  SELECT 'app-category', c.slug, c.name,
    COUNT(a.id) || CASE WHEN COUNT(a.id) = 1 THEN ' app' ELSE ' apps' END,
    c.slug,
    COUNT(a.id)
  FROM app_categories c LEFT JOIN apps a ON a.category_id = c.id AND a.status = 'active'
  GROUP BY c.id`,
  `INSERT INTO search_index (kind, ref, title, subtitle, keywords, boost)
  SELECT 'section-type', t.slug, t.name, t.group_name, t.description,
    (SELECT COUNT(*) FROM sections s JOIN stores st ON st.id = s.store_id AND st.status = 'active'
      WHERE s.section_type = t.slug AND s.is_current = 1)
  FROM section_types t`,
  `INSERT INTO search_index (kind, ref, title, subtitle, keywords, boost)
  SELECT 'teardown', td.slug, td.title, 'Teardown · ' || COALESCE(s.name, s.domain),
    COALESCE(td.dek, '') || ' ' || s.domain,
    500
  FROM teardowns td JOIN stores s ON s.id = td.store_id AND s.status = 'active'
  WHERE td.published_at IS NOT NULL`,
  `INSERT INTO search_index (kind, ref, title, subtitle, keywords, boost)
  SELECT 'vendor', t.vendor_slug, MIN(t.vendor),
    'Theme vendor · ' || COUNT(*) || CASE WHEN COUNT(*) = 1 THEN ' theme' ELSE ' themes' END,
    GROUP_CONCAT(t.name, ' '),
    COUNT(*) * 10
  FROM themes t WHERE t.vendor_slug IS NOT NULL AND t.status = 'active'
  GROUP BY t.vendor_slug`,
];

/** All rebuild statements in dependency order. */
export const REBUILD_DERIVED_SQL: readonly string[] = [
  ...STORE_STATE,
  ...APP_STATS,
  ...THEME_STATS,
  ...CO_INSTALLS,
  ...THEME_APP_USAGE,
  ...STORE_SIMILAR,
  ...SEARCH_INDEX,
];

/** Rebuilds all derived data in one atomic batch. */
export async function rebuildDerived(db: Db): Promise<void> {
  await db.batch(REBUILD_DERIVED_SQL.map((sql) => ({ sql })));
}
