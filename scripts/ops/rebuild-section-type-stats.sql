-- Rebuild section_type_stats from current sections. Safe to re-run.
DELETE FROM section_type_stats;
INSERT INTO section_type_stats (section_type, n, stores, themes, preview_section_id)
SELECT section_type, n, stores, themes, preview_section_id
FROM (
  SELECT s.section_type,
    COUNT(*) AS n,
    COUNT(DISTINCT s.store_id) AS stores,
    COUNT(DISTINCT s.theme_id) AS themes,
    (
      SELECT x.id
      FROM sections x
      JOIN stores y ON y.id = x.store_id AND y.status = 'active'
      WHERE x.is_current = 1 AND x.section_type = s.section_type
      ORDER BY x.is_placeholder, x.device, x.store_id, x.id
      LIMIT 1
    ) AS preview_section_id
  FROM sections s
  JOIN stores st ON st.id = s.store_id AND st.status = 'active'
  WHERE s.is_current = 1
  GROUP BY s.section_type
);
