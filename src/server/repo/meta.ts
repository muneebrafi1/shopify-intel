/** Data provenance and headline counts (GET /api/v1/meta). */
import type { Ctx } from '../api/v1/context.ts';
import type { DataMeta } from '../api/v1/schemas/misc.ts';

export async function getDataMeta(ctx: Ctx): Promise<DataMeta> {
  const c = await ctx.db.first<DataMeta['counts']>(
    `SELECT
      (SELECT COUNT(*) FROM stores WHERE status = 'active') AS stores_scanned,
      (SELECT COUNT(*) FROM stores WHERE status = 'active' AND is_curated = 1) AS stores_curated,
      (SELECT COUNT(*) FROM stores WHERE status = 'active' AND is_captured = 1) AS stores_captured,
      (SELECT COUNT(DISTINCT sh.store_id) FROM screenshots sh
         JOIN stores s ON s.id = sh.store_id AND s.status = 'active' WHERE sh.is_current = 1) AS stores_with_capture_plan,
      (SELECT COUNT(*) FROM themes WHERE status = 'active') AS themes,
      (SELECT COUNT(DISTINCT lower(current_theme_name)) FROM stores
         WHERE status = 'active' AND current_theme_name IS NOT NULL) AS theme_names_detected,
      (SELECT COUNT(*) FROM apps WHERE status = 'active') AS apps,
      (SELECT COUNT(*) FROM apps WHERE status = 'active' AND profile = 'full') AS apps_full,
      (SELECT COUNT(*) FROM apps WHERE status = 'active' AND profile = 'basic') AS apps_basic,
      (SELECT COUNT(*) FROM app_categories) AS app_categories,
      (SELECT COUNT(*) FROM screenshots sh JOIN stores s ON s.id = sh.store_id AND s.status = 'active'
         WHERE sh.is_current = 1) AS screenshots,
      (SELECT COUNT(*) FROM screenshots sh JOIN stores s ON s.id = sh.store_id AND s.status = 'active'
         WHERE sh.is_current = 1 AND sh.is_placeholder = 0) AS screenshots_captured,
      (SELECT COUNT(*) FROM screenshots sh JOIN stores s ON s.id = sh.store_id AND s.status = 'active'
         WHERE sh.is_current = 1 AND sh.is_placeholder = 1) AS screenshots_placeholder,
      (SELECT COUNT(*) FROM sections x JOIN stores s ON s.id = x.store_id AND s.status = 'active'
         WHERE x.is_current = 1) AS sections,
      (SELECT COUNT(*) FROM section_types) AS section_types,
      (SELECT COUNT(*) FROM teardowns td JOIN stores s ON s.id = td.store_id AND s.status = 'active'
         WHERE td.published_at IS NOT NULL) AS teardowns,
      (SELECT COUNT(*) FROM comparisons) AS comparisons`,
  );
  const d = ctx.data;
  return {
    data_version: d.dataVersion,
    data_as_of: d.dataAsOf,
    source: { id: d.scanSourceId, ...(d.sources[d.scanSourceId] ?? { label: d.scanSourceLabel, as_of: d.dataAsOf, url: null }) },
    rules_version: d.rulesVersion,
    app_store_checked: { from: d.appStoreCheckedFrom, to: d.appStoreCheckedTo },
    counts: c ?? {
      stores_scanned: 0,
      stores_curated: 0,
      stores_captured: 0,
      stores_with_capture_plan: 0,
      themes: 0,
      theme_names_detected: 0,
      apps: 0,
      apps_full: 0,
      apps_basic: 0,
      app_categories: 0,
      screenshots: 0,
      screenshots_captured: 0,
      screenshots_placeholder: 0,
      sections: 0,
      section_types: 0,
      teardowns: 0,
      comparisons: 0,
    },
  };
}
