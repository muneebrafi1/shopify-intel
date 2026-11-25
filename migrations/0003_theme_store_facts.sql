-- 0003_theme_store_facts.sql — facts published on each theme's Shopify Theme Store page.
--
-- Filled by the seed from data/curation/theme-store.json, which scripts/crawl/theme-store.ts
-- (npm run crawl:themes) reads from the public Theme Store page (themes.official_url). Presets go
-- into theme_presets (0001). The Theme Store publishes no style or industry tags, so theme_tags
-- stays empty: nothing is invented.
ALTER TABLE themes ADD COLUMN store_version TEXT;            -- current version on the Theme Store
ALTER TABLE themes ADD COLUMN review_positive_pct INTEGER;   -- 0-100, as published
ALTER TABLE themes ADD COLUMN review_count INTEGER;
ALTER TABLE themes ADD COLUMN store_checked_at TEXT;         -- when the Theme Store page was read

-- The theme's published feature list, in the Theme Store's own groups and order.
CREATE TABLE theme_features (
  theme_id INTEGER NOT NULL REFERENCES themes (id) ON DELETE CASCADE,
  feature_group TEXT NOT NULL,           -- 'Cart and checkout', 'Merchandising', ...
  item TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (theme_id, feature_group, item)
);
