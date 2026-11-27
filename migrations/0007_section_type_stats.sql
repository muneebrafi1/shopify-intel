-- Precomputed per-type counts and a preview section id (avoids a full 38k scan on every type page).
CREATE TABLE section_type_stats (
  section_type TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  stores INTEGER NOT NULL,
  themes INTEGER NOT NULL,
  preview_section_id INTEGER
);
CREATE INDEX idx_section_type_stats_preview ON section_type_stats (preview_section_id);
