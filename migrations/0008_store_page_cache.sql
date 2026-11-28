-- Precomputed store-page payloads so SSR is one indexed lookup under load.
CREATE TABLE store_page_cache (
  domain TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
