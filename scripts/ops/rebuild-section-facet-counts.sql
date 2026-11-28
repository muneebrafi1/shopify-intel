-- Rebuild section_facet_counts from current sections. Safe to re-run.
DELETE FROM section_facet_counts;

-- Unfiltered library (scope = '') and each section type (scope = that type).
-- type
INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT '', 'type', s.section_type, ty.name, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
JOIN section_types ty ON ty.slug = s.section_type
WHERE s.is_current = 1
GROUP BY s.section_type, ty.name;

INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT s.section_type, 'type', s.section_type, ty.name, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
JOIN section_types ty ON ty.slug = s.section_type
WHERE s.is_current = 1
GROUP BY s.section_type, ty.name;

-- group
INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT '', 'group', ty.group_slug, ty.group_name, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
JOIN section_types ty ON ty.slug = s.section_type
WHERE s.is_current = 1
GROUP BY ty.group_slug, ty.group_name;

INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT s.section_type, 'group', ty.group_slug, ty.group_name, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
JOIN section_types ty ON ty.slug = s.section_type
WHERE s.is_current = 1
GROUP BY s.section_type, ty.group_slug, ty.group_name;

-- page_type
INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT '', 'page_type', s.page_type, s.page_type, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
WHERE s.is_current = 1
GROUP BY s.page_type;

INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT s.section_type, 'page_type', s.page_type, s.page_type, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
WHERE s.is_current = 1
GROUP BY s.section_type, s.page_type;

-- device
INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT '', 'device', s.device, s.device, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
WHERE s.is_current = 1
GROUP BY s.device;

INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT s.section_type, 'device', s.device, s.device, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
WHERE s.is_current = 1
GROUP BY s.section_type, s.device;

-- theme (top 30 per scope)
INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT '', 'theme', t.slug, t.name, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
JOIN themes t ON t.id = s.theme_id
WHERE s.is_current = 1
GROUP BY t.id
ORDER BY COUNT(*) DESC, t.name
LIMIT 30;

INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT scope, 'theme', slug, name, count
FROM (
  SELECT s.section_type AS scope, t.slug AS slug, t.name AS name, COUNT(*) AS count,
         ROW_NUMBER() OVER (PARTITION BY s.section_type ORDER BY COUNT(*) DESC, t.name) AS rn
  FROM sections s
  JOIN stores st ON st.id = s.store_id AND st.status = 'active'
  JOIN themes t ON t.id = s.theme_id
  WHERE s.is_current = 1
  GROUP BY s.section_type, t.id
)
WHERE rn <= 30;

-- app (top 30 per scope)
INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT '', 'app', a.slug, a.short_name, COUNT(*)
FROM sections s
JOIN stores st ON st.id = s.store_id AND st.status = 'active'
JOIN apps a ON a.id = s.app_id
WHERE s.is_current = 1
GROUP BY a.id
ORDER BY COUNT(*) DESC, a.short_name
LIMIT 30;

INSERT INTO section_facet_counts (scope, facet, value, label, count)
SELECT scope, 'app', slug, name, count
FROM (
  SELECT s.section_type AS scope, a.slug AS slug, a.short_name AS name, COUNT(*) AS count,
         ROW_NUMBER() OVER (PARTITION BY s.section_type ORDER BY COUNT(*) DESC, a.short_name) AS rn
  FROM sections s
  JOIN stores st ON st.id = s.store_id AND st.status = 'active'
  JOIN apps a ON a.id = s.app_id
  WHERE s.is_current = 1
  GROUP BY s.section_type, a.id
)
WHERE rn <= 30;
