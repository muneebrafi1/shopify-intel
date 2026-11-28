-- Precomputed facet counts for section library pages (avoids six COUNT scans per request).
CREATE TABLE section_facet_counts (
  scope TEXT NOT NULL, -- '' = unfiltered library; otherwise a section_type slug
  facet TEXT NOT NULL, -- type | group | page_type | device | theme | app
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, facet, value)
);
CREATE INDEX idx_section_facet_counts_scope ON section_facet_counts (scope, facet, count DESC);
