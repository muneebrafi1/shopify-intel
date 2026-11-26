/**
 * Scan ingest: one crawl of a store's home page (theme, apps, pixels, storefront facts) into the
 * detection history tables. Called by the admin API (`POST /api/v1/admin/scans`), which the
 * local crawler (scripts/crawl/) posts to; written for the remote D1 too.
 *
 * Rules:
 *  - Opted-out or tombstoned stores are refused; unknown domains are refused (stores enter the
 *    catalogue through the seed or the admin, never as a side effect of a crawl).
 *  - Every accepted scan writes a `scans` row (source, rules version, HTTP status).
 *  - A scan that did not see a Shopify storefront changes nothing else (`not-shopify`).
 *  - Theme: the same theme + version extends the open `store_themes` row; anything else closes
 *    it (`replaced_at`) and opens a new one, so theme switches and version bumps are history.
 *  - Apps and pixels seen are opened or extended (`last_seen`). Ones not seen are NOT closed:
 *    a single home-page crawl misses apps that only load on other pages or after consent, so
 *    closing needs repeated misses (future work).
 *  - Detection slugs with no app record go to `store_unresolved_apps`.
 *  - Name: filled from the storefront's own site name only when the store has none (editorial
 *    names always win). URL and currency follow the latest scan.
 *  - Derived tables are not rebuilt here: call rebuildDerived(db) once after a batch.
 */
import { z } from 'zod';
import { PIXELS } from '../../lib/taxonomy.ts';
import type { Db, Statement } from '../db/types.ts';
import { normalizeDomain } from '../lib/slug.ts';

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const scanInputSchema = z.object({
  domain: z.string().min(3).max(253),
  url: z.url({ protocol: /^https?$/ }),
  scanned_at: z.iso.datetime(),
  source: z.string().min(3).max(80),
  rules_version: z.string().max(40).nullable().default(null),
  http_status: z.number().int().min(100).max(599).nullable().default(null),
  platform: z.enum(['shopify', 'shopify-headless', 'not-shopify']),
  site_name: z.string().max(120).nullable().default(null),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .default(null),
  theme: z
    .object({
      /** Base theme name (schema_name), e.g. "Prestige". */
      name: z.string().min(1).max(120),
      /** The merchant's own label for the theme copy, when different. */
      raw_name: z.string().max(200).nullable().default(null),
      version: z.string().max(40).nullable().default(null),
      theme_store_id: z.number().int().positive().nullable().default(null),
      is_custom: z.boolean().default(false),
    })
    .nullable()
    .default(null),
  apps: z
    .array(
      z.object({ slug, confidence: z.enum(['high', 'medium', 'low']).nullable().default(null) }),
    )
    .max(200)
    .default([]),
  pixels: z.array(slug).max(60).default([]),
});

export type ScanInput = z.input<typeof scanInputSchema>;

export type ScanResult =
  | {
      status: 'ingested';
      domain: string;
      scan_id: number;
      theme: 'unchanged' | 'changed' | 'new' | 'none';
      apps_added: number;
      apps_seen: number;
      unresolved: number;
      pixels_added: number;
    }
  | { status: 'not-shopify'; domain: string; scan_id: number }
  | { status: 'opted-out' | 'unknown-store'; domain: string };

const CONFIDENCE = { high: 0.9, medium: 0.6, low: 0.3 } as const;

export async function ingestScan(db: Db, input: ScanInput): Promise<ScanResult> {
  const s = scanInputSchema.parse(input);
  const domain = normalizeDomain(s.domain);
  if (!domain) return { status: 'unknown-store', domain: s.domain };
  const blocked = await db.first<{ x: number }>(
    `SELECT 1 AS x FROM store_tombstones WHERE domain = ?1
     UNION ALL SELECT 1 FROM stores WHERE domain = ?1 AND status = 'opted_out' LIMIT 1`,
    [domain],
  );
  if (blocked) return { status: 'opted-out', domain };
  const store = await db.first<{ id: number; name: string | null }>(
    `SELECT id, name FROM stores WHERE domain = ? AND status != 'opted_out'`,
    [domain],
  );
  if (!store) return { status: 'unknown-store', domain };

  const max = await db.first<{ scan: number; theme: number }>(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM scans) AS scan,
            (SELECT COALESCE(MAX(id), 0) FROM store_themes) AS theme`,
  );
  const scanId = (max?.scan ?? 0) + 1;
  const at = s.scanned_at;
  const stmts: Statement[] = [
    {
      sql: `INSERT INTO scans (id, store_id, ran_at, rules_version, source, http_status, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        scanId,
        store.id,
        at,
        s.rules_version,
        s.source,
        s.http_status,
        JSON.stringify({
          platform: s.platform,
          theme: s.theme,
          apps: s.apps,
          pixels: s.pixels,
          site_name: s.site_name,
        }),
      ],
    },
    // Provenance for meta.sources: the latest crawl date and the rules it ran.
    {
      sql: `INSERT INTO meta (key, value, updated_at) VALUES ('crawl_last_at', ?, ?), ('crawl_rules_version', ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            WHERE meta.key = 'crawl_rules_version' OR excluded.value > meta.value`,
      params: [at, at, s.rules_version, at],
    },
  ];
  if (s.platform === 'not-shopify') {
    await db.batch(stmts);
    return { status: 'not-shopify', domain, scan_id: scanId };
  }

  // Storefront facts.
  stmts.push({
    sql: `UPDATE stores SET url = ?, currency = COALESCE(?, currency),
            name = COALESCE(name, ?), last_seen = MAX(last_seen, ?), updated_at = ?
          WHERE id = ?`,
    params: [s.url, s.currency, store.name ? null : s.site_name, at, at, store.id],
  });

  // Theme history.
  let themeState: 'unchanged' | 'changed' | 'new' | 'none' = 'none';
  if (s.theme) {
    const t = s.theme;
    const known = await db.first<{ id: number }>(
      `SELECT id FROM themes WHERE (?1 IS NOT NULL AND theme_store_id = ?1)
         OR name = ?2 COLLATE NOCASE ORDER BY theme_store_id = ?1 DESC LIMIT 1`,
      [t.theme_store_id, t.name],
    );
    const open = await db.first<{
      id: number;
      theme_id: number | null;
      raw_name: string | null;
      version: string | null;
    }>(
      `SELECT id, theme_id, raw_name, version FROM store_themes
       WHERE store_id = ? AND replaced_at IS NULL`,
      [store.id],
    );
    const themeId = known?.id ?? null;
    const sameTheme =
      open &&
      (themeId !== null
        ? open.theme_id === themeId
        : // Unknown theme: the open row stores the merchant's label (raw_name ?? name).
          [t.raw_name ?? t.name, t.name].some(
            (n) => (open.raw_name ?? '').toLowerCase() === n.toLowerCase(),
          ));
    // A missing version on either side is "not observed", not a change.
    const sameVersion = !open?.version || !t.version || open.version === t.version;
    if (open && sameTheme && sameVersion) {
      themeState = 'unchanged';
      stmts.push({
        sql: `UPDATE store_themes SET last_seen = MAX(last_seen, ?), version = COALESCE(version, ?)
              WHERE id = ?`,
        params: [at, t.version, open.id],
      });
    } else {
      themeState = open ? 'changed' : 'new';
      if (open)
        stmts.push({
          sql: 'UPDATE store_themes SET replaced_at = ? WHERE id = ?',
          params: [at, open.id],
        });
      stmts.push({
        sql: `INSERT INTO store_themes (id, store_id, theme_id, raw_name, version, is_custom,
                first_seen, last_seen, replaced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        params: [
          (max?.theme ?? 0) + 1,
          store.id,
          themeId,
          t.raw_name ?? t.name,
          t.version,
          t.is_custom ? 1 : 0,
          at,
          at,
        ],
      });
    }
  }

  // Apps.
  const slugs = [...new Set(s.apps.map((a) => a.slug))];
  const resolved = slugs.length
    ? await db.all<{ slug: string; app_id: number }>(
        `SELECT a.slug, a.id AS app_id FROM apps a WHERE a.slug IN (SELECT value FROM json_each(?1))
         UNION SELECT al.slug, al.app_id FROM app_aliases al
         WHERE al.slug IN (SELECT value FROM json_each(?1))`,
        [JSON.stringify(slugs)],
      )
    : [];
  const appOf = new Map(resolved.map((r) => [r.slug, r.app_id]));
  const openApps = new Set(
    (
      await db.all<{ app_id: number }>(
        'SELECT app_id FROM store_apps WHERE store_id = ? AND removed_at IS NULL',
        [store.id],
      )
    ).map((r) => r.app_id),
  );
  const openUnresolved = new Set(
    (
      await db.all<{ detection_slug: string }>(
        'SELECT detection_slug FROM store_unresolved_apps WHERE store_id = ? AND removed_at IS NULL',
        [store.id],
      )
    ).map((r) => r.detection_slug),
  );
  const unresolvedSlugs = slugs.filter((x) => !appOf.has(x));
  const seen = new Map<number, number | null>(); // app id → confidence (alias + canonical once)
  for (const a of s.apps) {
    const appId = appOf.get(a.slug);
    if (appId === undefined || seen.has(appId)) continue;
    seen.set(appId, a.confidence ? CONFIDENCE[a.confidence] : null);
  }
  const seenRows = [...seen].map(([id, c]) => ({ id, c }));
  const addedApps = seenRows.filter((r) => !openApps.has(r.id));
  const keptApps = seenRows.filter((r) => openApps.has(r.id));
  const json = JSON.stringify;
  // Set-based writes: a handful of statements per scan however many apps a store runs (D1's
  // free plan allows 50 statements per request).
  if (keptApps.length)
    stmts.push({
      sql: `UPDATE store_apps SET last_seen = MAX(last_seen, ?1),
              confidence = COALESCE((SELECT json_extract(j.value, '$.c') FROM json_each(?2) j
                                     WHERE json_extract(j.value, '$.id') = store_apps.app_id), confidence)
            WHERE store_id = ?3 AND removed_at IS NULL
              AND app_id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
      params: [at, json(keptApps), store.id],
    });
  if (addedApps.length)
    stmts.push({
      sql: `INSERT OR IGNORE INTO store_apps (store_id, app_id, confidence, first_seen, last_seen, removed_at)
            SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.c'), ?2, ?2, NULL
            FROM json_each(?3)`,
      params: [store.id, at, json(addedApps)],
    });
  const keptUnresolved = unresolvedSlugs.filter((x) => openUnresolved.has(x));
  const newUnresolved = unresolvedSlugs.filter((x) => !openUnresolved.has(x));
  if (keptUnresolved.length)
    stmts.push({
      sql: `UPDATE store_unresolved_apps SET last_seen = MAX(last_seen, ?1)
            WHERE store_id = ?2 AND removed_at IS NULL
              AND detection_slug IN (SELECT value FROM json_each(?3))`,
      params: [at, store.id, json(keptUnresolved)],
    });
  if (newUnresolved.length)
    stmts.push({
      sql: `INSERT OR IGNORE INTO store_unresolved_apps (store_id, detection_slug, first_seen, last_seen, removed_at)
            SELECT ?1, value, ?2, ?2, NULL FROM json_each(?3)`,
      params: [store.id, at, json(newUnresolved)],
    });

  // Pixels (only the ones we can name).
  const openPixels = new Set(
    (
      await db.all<{ pixel: string }>(
        'SELECT pixel FROM store_pixels WHERE store_id = ? AND removed_at IS NULL',
        [store.id],
      )
    ).map((r) => r.pixel),
  );
  const pixels = [...new Set(s.pixels)].filter((p) => p in PIXELS);
  const newPixels = pixels.filter((p) => !openPixels.has(p));
  const keptPixels = pixels.filter((p) => openPixels.has(p));
  if (keptPixels.length)
    stmts.push({
      sql: `UPDATE store_pixels SET last_seen = MAX(last_seen, ?1)
            WHERE store_id = ?2 AND removed_at IS NULL AND pixel IN (SELECT value FROM json_each(?3))`,
      params: [at, store.id, json(keptPixels)],
    });
  if (newPixels.length)
    stmts.push({
      sql: `INSERT OR IGNORE INTO store_pixels (store_id, pixel, first_seen, last_seen, removed_at)
            SELECT ?1, value, ?2, ?2, NULL FROM json_each(?3)`,
      params: [store.id, at, json(newPixels)],
    });

  await db.batch(stmts);
  return {
    status: 'ingested',
    domain,
    scan_id: scanId,
    theme: themeState,
    apps_added: addedApps.length,
    apps_seen: seen.size,
    unresolved: unresolvedSlugs.length,
    pixels_added: newPixels.length,
  };
}
