-- 0001_init.sql — base schema for the visual library + detection history.
--
-- Conventions
--   * Timestamps are ISO-8601 UTC text ('2026-11-17T09:21:19.299Z'); days are 'YYYY-MM-DD'.
--   * Booleans are INTEGER 0/1 with CHECK constraints.
--   * JSON columns end in _json and hold text produced by JSON.stringify (read-only for SQL).
--   * Money is stored in integer cents (USD unless a column says otherwise).
--   * Detection tables are append-only history: a change closes the open row (removed_at /
--     replaced_at) and opens a new one. "Current" state is the open row.
--   * Columns prefixed current_ on `stores` and all *_stats tables are denormalised caches rebuilt
--     at ingest (see src/server/repo/maintenance.ts). Public reads use them so list pages stay
--     index-only at 50K+ stores.
--   * Every public query must filter stores.status = 'active' (hidden / opted-out stores never
--     appear anywhere public, including counts, which are rebuilt after an opt-out).

-- ---------------------------------------------------------------------------------------------
-- Meta: data provenance and versioning (data_version drives API ETags).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------------------------
CREATE TABLE store_categories (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE app_categories (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

-- Seeded from src/lib/taxonomy.ts (SECTION_TYPES). Slugs are public identifiers.
CREATE TABLE section_types (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_slug TEXT NOT NULL,
  group_name TEXT NOT NULL,
  description TEXT NOT NULL,
  position INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------------------------
-- Catalogue: themes and apps
-- ---------------------------------------------------------------------------------------------
CREATE TABLE themes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vendor TEXT,
  vendor_slug TEXT,
  theme_store_id INTEGER,                -- Shopify Theme Store numeric id, when listed there
  price_cents INTEGER,                   -- 0 = free, NULL = unknown
  price_label TEXT,                      -- as published ('$400', 'Free')
  marketplace TEXT,                      -- 'Shopify Theme Store', 'ThemeForest', ...
  official_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_themes_vendor ON themes (vendor_slug);
CREATE INDEX idx_themes_name ON themes (name COLLATE NOCASE);

CREATE TABLE theme_presets (
  id INTEGER PRIMARY KEY,
  theme_id INTEGER NOT NULL REFERENCES themes (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (theme_id, slug)
);

-- Editorial style / industry tags. Intentionally empty in the seed (no invented data).
CREATE TABLE theme_tags (
  theme_id INTEGER NOT NULL REFERENCES themes (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('style', 'industry')),
  tag TEXT NOT NULL,
  PRIMARY KEY (theme_id, kind, tag)
);
CREATE INDEX idx_theme_tags_tag ON theme_tags (kind, tag);

CREATE TABLE apps (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,             -- our public slug (= detection slug of the primary rule)
  app_store_handle TEXT,                 -- apps.shopify.com/<handle>
  name TEXT NOT NULL,                    -- full App Store listing name
  short_name TEXT NOT NULL,              -- brand name for compact UI ('Klaviyo'); see build-seed
  developer TEXT,
  category_id INTEGER REFERENCES app_categories (id),
  app_store_category TEXT,               -- Shopify's own category label
  tagline TEXT,
  rating REAL,                           -- NULL when the listing has no reviews yet
  reviews INTEGER,
  icon_url TEXT,
  app_store_url TEXT,                    -- apps.shopify.com listing, when there is one
  website_url TEXT,                      -- developer site for apps not listed on the App Store
  launched_on TEXT,                      -- YYYY-MM-DD
  built_for_shopify INTEGER CHECK (built_for_shopify IN (0, 1)), -- NULL = unknown
  free_plan INTEGER CHECK (free_plan IN (0, 1)),
  from_price_cents INTEGER,              -- cheapest paid plan per month; NULL = unknown
  trial_days INTEGER,
  plans_json TEXT,                       -- [{name, price_label, price_cents, period, trial_days, features[]}]
  features_json TEXT,                    -- string[]
  works_with_json TEXT,                  -- string[]
  languages_json TEXT,                   -- string[]
  checked_on TEXT,                       -- day the App Store listing was last read
  -- 'full' = rich profile page (App Store facts), 'basic' = detected app with a light record.
  profile TEXT NOT NULL DEFAULT 'basic' CHECK (profile IN ('full', 'basic')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'delisted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_apps_category ON apps (category_id);
CREATE INDEX idx_apps_handle ON apps (app_store_handle);

-- Extra detection slugs that resolve to an existing app (two detection rules, one listing).
-- Old slugs keep resolving so URLs can 301 to the canonical app.
CREATE TABLE app_aliases (
  slug TEXT PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES apps (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------------------------------
CREATE TABLE stores (
  id INTEGER PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,           -- lowercase bare host without www.
  name TEXT,                             -- editorial; UI falls back to the domain
  url TEXT,                              -- canonical storefront URL as crawled
  country TEXT,                          -- ISO 3166-1 alpha-2, only when unambiguous
  currency TEXT,                         -- ISO 4217 storefront currency
  category_slug TEXT REFERENCES store_categories (slug),
  tranco_rank INTEGER,                   -- Tranco list rank (lower = more popular)
  is_curated INTEGER NOT NULL DEFAULT 0 CHECK (is_curated IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'opted_out')),
  opted_out_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  -- Denormalised current state (rebuilt from the history tables at ingest):
  current_theme_id INTEGER REFERENCES themes (id),
  current_theme_name TEXT,               -- raw detected name, also for themes we have no record of
  current_theme_version TEXT,
  current_theme_is_custom INTEGER NOT NULL DEFAULT 0 CHECK (current_theme_is_custom IN (0, 1)),
  app_count INTEGER NOT NULL DEFAULT 0,  -- resolved + unresolved open app detections
  is_captured INTEGER NOT NULL DEFAULT 0 CHECK (is_captured IN (0, 1)), -- has >= 1 real screenshot
  -- Precomputed position for the default 'rank' sort (Tranco rank, then curated, then app count,
  -- then domain) so keyset pagination uses a single indexed integer.
  list_position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_stores_list ON stores (status, list_position);
CREATE INDEX idx_stores_theme ON stores (current_theme_id, status, list_position);
CREATE INDEX idx_stores_theme_name ON stores (current_theme_name COLLATE NOCASE);
CREATE INDEX idx_stores_category ON stores (category_slug, status);
CREATE INDEX idx_stores_currency ON stores (currency, status);
CREATE INDEX idx_stores_country ON stores (country, status);
CREATE INDEX idx_stores_curated ON stores (is_curated, status, list_position);
CREATE INDEX idx_stores_apps ON stores (status, app_count DESC, domain);
CREATE INDEX idx_stores_recent ON stores (status, last_seen DESC, domain);

-- Opted-out domains. Kept forever (without any other data) so the crawler never re-adds them.
CREATE TABLE store_tombstones (
  domain TEXT PRIMARY KEY,
  reason TEXT,
  removal_request_id INTEGER,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------------------------
-- Detection history (append-only)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE scans (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  ran_at TEXT NOT NULL,
  rules_version TEXT,                    -- detection signature version (e.g. 'pre-v7')
  source TEXT NOT NULL,                  -- 'storepeek-scan-2026-11-17'
  http_status INTEGER,
  raw_json TEXT                          -- optional raw detector output for re-processing
);
CREATE INDEX idx_scans_store ON scans (store_id, ran_at);

-- A row covers one (theme, version) observation span. A version bump or theme switch closes the
-- row (replaced_at) and opens a new one; compare theme_id across rows to tell them apart.
CREATE TABLE store_themes (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  theme_id INTEGER REFERENCES themes (id), -- NULL when the theme has no record (raw_name only)
  preset_id INTEGER REFERENCES theme_presets (id),
  raw_name TEXT,                         -- name as detected; NULL when no theme was detected
  version TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  replaced_at TEXT
);
CREATE UNIQUE INDEX idx_store_themes_open ON store_themes (store_id) WHERE replaced_at IS NULL;
CREATE INDEX idx_store_themes_theme ON store_themes (theme_id, replaced_at);

CREATE TABLE store_apps (
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  app_id INTEGER NOT NULL REFERENCES apps (id),
  confidence REAL,                       -- 0..1 detector confidence; NULL in pre-v7 scans
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (store_id, app_id, first_seen)
);
CREATE INDEX idx_store_apps_app ON store_apps (app_id, removed_at, store_id);
CREATE INDEX idx_store_apps_store ON store_apps (store_id, removed_at);

-- Detection slugs we have no app profile for yet (kept so counts stay honest and the profile can
-- be backfilled later without a rescan).
CREATE TABLE store_unresolved_apps (
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  detection_slug TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (store_id, detection_slug, first_seen)
);
CREATE INDEX idx_store_unresolved_slug ON store_unresolved_apps (detection_slug, removed_at);

CREATE TABLE store_pixels (
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  pixel TEXT NOT NULL,                   -- key of PIXELS in src/lib/taxonomy.ts
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (store_id, pixel, first_seen)
);
CREATE INDEX idx_store_pixels_pixel ON store_pixels (pixel, removed_at);

-- ---------------------------------------------------------------------------------------------
-- Visual library
-- ---------------------------------------------------------------------------------------------
CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  page_type TEXT NOT NULL CHECK (page_type IN ('home', 'collection', 'product', 'cart', 'search',
    'blog', 'article', 'page', 'not-found')),
  url TEXT,                              -- NULL for planned (placeholder) pages
  is_placeholder INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pages_store ON pages (store_id, page_type);

CREATE TABLE screenshots (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE, -- denormalised from pages
  page_type TEXT NOT NULL,               -- denormalised from pages
  device TEXT NOT NULL CHECK (device IN ('desktop', 'mobile')),
  viewport_w INTEGER NOT NULL,           -- CSS px viewport used for the capture
  width INTEGER NOT NULL,                -- CSS px of the full-page image (= viewport_w)
  height INTEGER NOT NULL,               -- CSS px of the full page
  bytes INTEGER,
  r2_key TEXT,                           -- NULL until captured
  captured_at TEXT,                      -- NULL until captured
  theme_id INTEGER REFERENCES themes (id), -- theme at capture time
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  -- 1 = planned capture with a generated layout; real captures replace these rows.
  is_placeholder INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_screenshots_page ON screenshots (page_id, device, is_current);
CREATE INDEX idx_screenshots_store ON screenshots (store_id, is_current, page_type, device);
CREATE INDEX idx_screenshots_theme ON screenshots (theme_id, is_current, page_type, device);

-- A section is a rectangle on a screenshot. Most span the full width (x = 0, w = NULL). Desktop
-- product pages have one two-column row: product-gallery (left) and buy-box (right) share the
-- same y and height; likewise sidebar filters beside the product grid. Page height = max(y+height).
CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  screenshot_id INTEGER NOT NULL REFERENCES screenshots (id) ON DELETE CASCADE,
  section_type TEXT NOT NULL REFERENCES section_types (slug),
  y INTEGER NOT NULL,
  height INTEGER NOT NULL,
  x INTEGER NOT NULL DEFAULT 0,
  w INTEGER,                             -- NULL = full screenshot width
  order_index INTEGER NOT NULL,          -- reading order on the page
  app_id INTEGER REFERENCES apps (id),   -- app that renders this section, when attributed
  theme_section_name TEXT,               -- Liquid section file name when known (never guessed)
  r2_key_crop TEXT,                      -- pre-cut crop in R2; NULL = crop on the fly / placeholder
  is_placeholder INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0, 1)),
  -- Layout hints for renderers, e.g. {"style":"split"} or {"columns":4}. Free-form JSON object.
  hints_json TEXT,
  -- Denormalised from screenshots/pages so library filters need no joins:
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  page_type TEXT NOT NULL,
  device TEXT NOT NULL,
  theme_id INTEGER REFERENCES themes (id),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1))
);
CREATE INDEX idx_sections_screenshot ON sections (screenshot_id, order_index);
CREATE INDEX idx_sections_type ON sections (is_current, section_type, id);
CREATE INDEX idx_sections_theme ON sections (theme_id, is_current, section_type);
CREATE INDEX idx_sections_app ON sections (app_id, is_current);
CREATE INDEX idx_sections_store ON sections (store_id, is_current);
CREATE INDEX idx_sections_page_device ON sections (page_type, device, is_current);

CREATE TABLE section_tags (
  section_id INTEGER NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (section_id, tag)
);
CREATE INDEX idx_section_tags_tag ON section_tags (tag);

-- ---------------------------------------------------------------------------------------------
-- Editorial
-- ---------------------------------------------------------------------------------------------
CREATE TABLE teardowns (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  dek TEXT,
  body_md TEXT NOT NULL,
  published_at TEXT,                     -- NULL = draft
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)), -- format demo, not real research
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_teardowns_store ON teardowns (store_id);

-- Numbered callouts. section_id/screenshot_id are resolved at ingest from
-- (page_type, device, section_type) on the store's current screenshots.
CREATE TABLE teardown_notes (
  id INTEGER PRIMARY KEY,
  teardown_id INTEGER NOT NULL REFERENCES teardowns (id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  page_type TEXT NOT NULL,
  device TEXT NOT NULL CHECK (device IN ('desktop', 'mobile')),
  section_type TEXT NOT NULL REFERENCES section_types (slug),
  screenshot_id INTEGER REFERENCES screenshots (id) ON DELETE SET NULL,
  section_id INTEGER REFERENCES sections (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (teardown_id, n)
);

-- Curated / popular pairs for the comparisons index. Any valid pair still renders on demand.
-- a_slug < b_slug alphabetically; slug = '<a_slug>-vs-<b_slug>'.
CREATE TABLE comparisons (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('app', 'theme')),
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,                  -- 'category-top' | 'usage-top' | 'same-vendor' | 'editorial'
  position INTEGER NOT NULL DEFAULT 0,
  body_md TEXT,
  created_at TEXT NOT NULL,
  CHECK (a_id <> b_id)
);
CREATE INDEX idx_comparisons_a ON comparisons (kind, a_id);
CREATE INDEX idx_comparisons_b ON comparisons (kind, b_id);

-- ---------------------------------------------------------------------------------------------
-- Money: affiliate programs, links and anonymous click counts
-- ---------------------------------------------------------------------------------------------
CREATE TABLE affiliate_programs (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  network TEXT,
  status TEXT NOT NULL                   -- 'approved', 'pending', 'no-public-program', ...
);

-- Public referral URLs (not secrets). Only /go/<id> is exposed by the API; the raw URL is used
-- by the redirect. Links whose target has no record keep target_id NULL until it exists.
CREATE TABLE affiliate_links (
  id INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('app', 'theme', 'vendor')),
  target_id INTEGER,
  target_name TEXT NOT NULL,
  program_id INTEGER REFERENCES affiliate_programs (id),
  url TEXT NOT NULL,
  label TEXT,                            -- disclosure label shown next to the CTA
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_affiliate_links_target ON affiliate_links (target_type, target_id, active);

CREATE TABLE clicks (
  link_id INTEGER NOT NULL REFERENCES affiliate_links (id) ON DELETE CASCADE,
  day TEXT NOT NULL,                     -- YYYY-MM-DD (UTC); no per-visitor data is stored
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
);

-- ---------------------------------------------------------------------------------------------
-- Accounts (designed now, wired later via Whop)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  whop_member_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team', 'lifetime')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, slug)
);

CREATE TABLE collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('screenshot', 'section', 'store', 'theme', 'app')),
  item_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, item_type, item_id)
);
CREATE INDEX idx_collection_items_item ON collection_items (item_type, item_id);

-- ---------------------------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------------------------
CREATE TABLE removal_requests (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,        -- public reference shown to the requester ('RR-7KQ2M9XD')
  domain TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  reason TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('store', 'screenshots', 'details')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'done')),
  admin_note TEXT,
  ip_hash TEXT,                          -- salted SHA-256 of the client IP (rate limiting only)
  created_at TEXT NOT NULL,
  handled_at TEXT
);
CREATE INDEX idx_removal_requests_status ON removal_requests (status, created_at);
CREATE INDEX idx_removal_requests_ip ON removal_requests (ip_hash, created_at);
CREATE INDEX idx_removal_requests_domain ON removal_requests (domain, created_at);

-- Rescan / capture queue consumed by the external crawler.
CREATE TABLE scan_jobs (
  id INTEGER PRIMARY KEY,
  store_id INTEGER REFERENCES stores (id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('detect', 'capture', 'rescan')),
  page_types_json TEXT,                  -- e.g. ["home","product"]; NULL = core page types
  devices_json TEXT,                     -- e.g. ["desktop","mobile"]; NULL = both
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_scan_jobs_queue ON scan_jobs (status, priority DESC, created_at);

CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_admin_audit_created ON admin_audit (created_at);

-- ---------------------------------------------------------------------------------------------
-- Summary tables (rebuilt at ingest by src/server/repo/maintenance.ts; never edited by hand)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app_stats (
  app_id INTEGER PRIMARY KEY REFERENCES apps (id) ON DELETE CASCADE,
  store_count INTEGER NOT NULL,          -- active stores with an open detection
  curated_store_count INTEGER NOT NULL,
  denominator INTEGER NOT NULL,          -- active scanned stores the share is measured against
  section_count INTEGER NOT NULL,        -- current sections attributed to the app
  rank_overall INTEGER NOT NULL,
  rank_in_category INTEGER NOT NULL,
  as_of TEXT NOT NULL
);
CREATE INDEX idx_app_stats_count ON app_stats (store_count DESC);

CREATE TABLE theme_stats (
  theme_id INTEGER PRIMARY KEY REFERENCES themes (id) ON DELETE CASCADE,
  store_count INTEGER NOT NULL,
  curated_store_count INTEGER NOT NULL,
  denominator INTEGER NOT NULL,
  section_count INTEGER NOT NULL,
  screenshot_count INTEGER NOT NULL,
  avg_app_count REAL,
  rank_overall INTEGER NOT NULL,
  as_of TEXT NOT NULL
);

-- Both directions are stored so "apps installed with X" is a single indexed range read.
CREATE TABLE app_co_installs (
  app_id INTEGER NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  other_app_id INTEGER NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  store_count INTEGER NOT NULL,
  PRIMARY KEY (app_id, other_app_id)
);
CREATE INDEX idx_app_co_installs_rank ON app_co_installs (app_id, store_count DESC);

-- "Apps most used with this theme" and "themes most used by stores running this app".
CREATE TABLE theme_app_usage (
  theme_id INTEGER NOT NULL REFERENCES themes (id) ON DELETE CASCADE,
  app_id INTEGER NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  store_count INTEGER NOT NULL,
  PRIMARY KEY (theme_id, app_id)
);
CREATE INDEX idx_theme_app_usage_app ON theme_app_usage (app_id, store_count DESC);
CREATE INDEX idx_theme_app_usage_theme ON theme_app_usage (theme_id, store_count DESC);

-- Top similar stores per store (same theme + shared apps). Filtered by status at read time.
CREATE TABLE store_similar (
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  other_store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  same_theme INTEGER NOT NULL,
  shared_apps INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (store_id, other_store_id)
);
CREATE INDEX idx_store_similar_rank ON store_similar (store_id, score DESC);

-- ---------------------------------------------------------------------------------------------
-- Search (FTS5). Rebuilt from the tables above; only active stores are indexed.
--   kind: store | theme | app | app-category | section-type | teardown | vendor
--   ref:  the public identifier (domain / slug)
--   subtitle: display only (not matched)
--   boost: popularity used to break ties (higher = earlier)
-- prefix='2 3' builds prefix indexes so 'pre*' style queries stay fast.
-- ---------------------------------------------------------------------------------------------
CREATE VIRTUAL TABLE search_index USING fts5 (
  kind UNINDEXED,
  ref UNINDEXED,
  title,
  subtitle UNINDEXED,
  keywords,
  boost UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
