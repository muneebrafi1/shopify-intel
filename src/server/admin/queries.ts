/**
 * Read queries for the admin. Plain SQL against the Db interface (SQLite dialect shared by D1
 * and node:sqlite). Unlike the public API, these see every status (hidden, opted out, drafts).
 */
import type { Db, SqlValue } from '../db/types.ts';

export const PAGE_SIZE = 50;

/** LIKE pattern with %, _ and \ escaped (use with `ESCAPE '\'`). */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ---------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------
export interface NavCounts {
  pendingRemovals: number;
  openJobs: number;
}

export async function getNavCounts(db: Db): Promise<NavCounts> {
  const row = await db.first<{ r: number; j: number }>(
    `SELECT (SELECT COUNT(*) FROM removal_requests WHERE status = 'pending') AS r,
            (SELECT COUNT(*) FROM scan_jobs WHERE status IN ('queued', 'running')) AS j`,
  );
  return { pendingRemovals: row?.r ?? 0, openJobs: row?.j ?? 0 };
}

export interface MetaInfo {
  dataAsOf: string | null;
  dataVersion: string | null;
  rulesVersion: string | null;
  sourceLabel: string | null;
  scannedTotal: number | null;
  updatedAt: string | null;
}

export async function getMeta(db: Db): Promise<MetaInfo> {
  const rows = await db.all<{ key: string; value: string; updated_at: string }>(
    'SELECT key, value, updated_at FROM meta',
  );
  const m = new Map(rows.map((r) => [r.key, r]));
  const scanned = m.get('scanned_total')?.value;
  return {
    dataAsOf: m.get('data_as_of')?.value ?? null,
    dataVersion: m.get('data_version')?.value ?? null,
    rulesVersion: m.get('rules_version')?.value ?? null,
    sourceLabel: m.get('source_label')?.value ?? null,
    scannedTotal: scanned ? Number(scanned) : null,
    updatedAt: m.get('data_version')?.updated_at ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------
export interface OverviewCounts {
  stores: number;
  storesActive: number;
  storesHidden: number;
  storesOptedOut: number;
  curated: number;
  captured: number;
  placeholderShots: number;
  placeholderStores: number;
  realShots: number;
  themes: number;
  themesActive: number;
  apps: number;
  appsActive: number;
  appsFull: number;
  teardowns: number;
  teardownsPublished: number;
  linksActive: number;
  tombstones: number;
}

export async function getOverviewCounts(db: Db): Promise<OverviewCounts> {
  const r = await db.first<OverviewCounts>(
    `SELECT
      (SELECT COUNT(*) FROM stores) AS stores,
      (SELECT COUNT(*) FROM stores WHERE status = 'active') AS storesActive,
      (SELECT COUNT(*) FROM stores WHERE status = 'hidden') AS storesHidden,
      (SELECT COUNT(*) FROM stores WHERE status = 'opted_out') AS storesOptedOut,
      (SELECT COUNT(*) FROM stores WHERE is_curated = 1) AS curated,
      (SELECT COUNT(*) FROM stores WHERE is_captured = 1) AS captured,
      (SELECT COUNT(*) FROM screenshots WHERE is_current = 1 AND is_placeholder = 1) AS placeholderShots,
      (SELECT COUNT(DISTINCT store_id) FROM screenshots WHERE is_current = 1 AND is_placeholder = 1) AS placeholderStores,
      (SELECT COUNT(*) FROM screenshots WHERE is_current = 1 AND is_placeholder = 0 AND r2_key IS NOT NULL) AS realShots,
      (SELECT COUNT(*) FROM themes) AS themes,
      (SELECT COUNT(*) FROM themes WHERE status = 'active') AS themesActive,
      (SELECT COUNT(*) FROM apps) AS apps,
      (SELECT COUNT(*) FROM apps WHERE status = 'active') AS appsActive,
      (SELECT COUNT(*) FROM apps WHERE profile = 'full') AS appsFull,
      (SELECT COUNT(*) FROM teardowns) AS teardowns,
      (SELECT COUNT(*) FROM teardowns WHERE published_at IS NOT NULL) AS teardownsPublished,
      (SELECT COUNT(*) FROM affiliate_links WHERE active = 1) AS linksActive,
      (SELECT COUNT(*) FROM store_tombstones) AS tombstones`,
  );
  if (!r) throw new Error('overview query returned no row');
  return r;
}

export interface JobStatusCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
}

export async function getJobStatusCounts(db: Db): Promise<JobStatusCounts> {
  const rows = await db.all<{ status: keyof JobStatusCounts; n: number }>(
    'SELECT status, COUNT(*) AS n FROM scan_jobs GROUP BY status',
  );
  const out: JobStatusCounts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const r of rows) if (r.status in out) out[r.status] = r.n;
  return out;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail_json: string | null;
  created_at: string;
}

export async function getRecentAudit(
  db: Db,
  opts: { limit?: number; targetType?: string; targetId?: string } = {},
): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (opts.targetType) {
    where.push('target_type = ?');
    params.push(opts.targetType);
  }
  if (opts.targetId) {
    where.push('target_id = ?');
    params.push(opts.targetId);
  }
  params.push(opts.limit ?? 12);
  return db.all<AuditRow>(
    `SELECT id, actor, action, target_type, target_id, detail_json, created_at FROM admin_audit
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY id DESC LIMIT ?`,
    params,
  );
}

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------
export const STORE_SORTS = {
  rank: 's.list_position ASC',
  recent: 's.last_seen DESC, s.domain',
  apps: 's.app_count DESC, s.domain',
  domain: 's.domain ASC',
  updated: 's.updated_at DESC, s.domain',
} as const;
export type StoreSort = keyof typeof STORE_SORTS;

export interface StoreFilters {
  q?: string;
  status?: 'active' | 'hidden' | 'opted_out';
  curated?: boolean;
  captured?: 'yes' | 'placeholder' | 'no';
  theme?: string;
  app?: string;
  sort?: StoreSort;
  page?: number;
}

export interface StoreListRow {
  id: number;
  domain: string;
  name: string | null;
  status: string;
  is_curated: number;
  is_captured: number;
  placeholder_shots: number;
  current_theme_name: string | null;
  current_theme_version: string | null;
  current_theme_is_custom: number;
  theme_slug: string | null;
  theme_name: string | null;
  app_count: number;
  category_slug: string | null;
  country: string | null;
  tranco_rank: number | null;
  last_seen: string;
  updated_at: string;
}

export async function listStores(
  db: Db,
  f: StoreFilters,
): Promise<{ rows: StoreListRow[]; total: number; page: number }> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  const q = f.q?.trim().toLowerCase();
  if (q) {
    where.push(`(s.domain LIKE ? ESCAPE '\\' OR lower(COALESCE(s.name, '')) LIKE ? ESCAPE '\\')`);
    params.push(likePattern(q), likePattern(q));
  }
  if (f.status) {
    where.push('s.status = ?');
    params.push(f.status);
  }
  if (f.curated !== undefined) {
    where.push('s.is_curated = ?');
    params.push(f.curated ? 1 : 0);
  }
  if (f.captured === 'yes') where.push('s.is_captured = 1');
  if (f.captured === 'no') {
    where.push(
      `s.is_captured = 0 AND NOT EXISTS (SELECT 1 FROM screenshots x WHERE x.store_id = s.id AND x.is_current = 1)`,
    );
  }
  if (f.captured === 'placeholder') {
    where.push(
      `s.is_captured = 0 AND EXISTS (SELECT 1 FROM screenshots x WHERE x.store_id = s.id AND x.is_current = 1 AND x.is_placeholder = 1)`,
    );
  }
  if (f.theme) {
    where.push('t.slug = ?');
    params.push(f.theme);
  }
  if (f.app) {
    where.push(
      `EXISTS (SELECT 1 FROM store_apps sa JOIN apps a ON a.id = sa.app_id WHERE sa.store_id = s.id AND sa.removed_at IS NULL AND a.slug = ?)`,
    );
    params.push(f.app);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM stores s LEFT JOIN themes t ON t.id = s.current_theme_id';

  const totalRow = await db.first<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${whereSql}`, params);
  const total = totalRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  const rows = await db.all<StoreListRow>(
    `SELECT s.id, s.domain, s.name, s.status, s.is_curated, s.is_captured,
       (SELECT COUNT(*) FROM screenshots x WHERE x.store_id = s.id AND x.is_current = 1 AND x.is_placeholder = 1) AS placeholder_shots,
       s.current_theme_name, s.current_theme_version, s.current_theme_is_custom,
       t.slug AS theme_slug, t.name AS theme_name, s.app_count, s.category_slug, s.country,
       s.tranco_rank, s.last_seen, s.updated_at
     ${from} ${whereSql}
     ORDER BY ${STORE_SORTS[f.sort ?? 'rank']}
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  return { rows, total, page };
}

export interface Option {
  value: string;
  label: string;
  count?: number;
}

export async function getStoreFilterOptions(db: Db): Promise<{ themes: Option[]; apps: Option[] }> {
  const [themes, apps] = await Promise.all([
    db.all<{ slug: string; name: string; n: number }>(
      `SELECT t.slug, t.name, COUNT(s.id) AS n FROM themes t
       JOIN stores s ON s.current_theme_id = t.id
       GROUP BY t.id ORDER BY n DESC, t.name`,
    ),
    db.all<{ slug: string; name: string; n: number }>(
      `SELECT a.slug, a.name, COUNT(DISTINCT sa.store_id) AS n FROM apps a
       JOIN store_apps sa ON sa.app_id = a.id AND sa.removed_at IS NULL
       GROUP BY a.id ORDER BY n DESC, a.name LIMIT 120`,
    ),
  ]);
  return {
    themes: themes.map((t) => ({ value: t.slug, label: t.name, count: t.n })),
    apps: apps.map((a) => ({ value: a.slug, label: a.name, count: a.n })),
  };
}

export interface StoreDetail {
  id: number;
  domain: string;
  name: string | null;
  url: string | null;
  country: string | null;
  currency: string | null;
  category_slug: string | null;
  category_name: string | null;
  tranco_rank: number | null;
  is_curated: number;
  is_captured: number;
  status: 'active' | 'hidden' | 'opted_out';
  opted_out_at: string | null;
  first_seen: string;
  last_seen: string;
  current_theme_name: string | null;
  current_theme_version: string | null;
  theme_slug: string | null;
  theme_name: string | null;
  app_count: number;
  created_at: string;
  updated_at: string;
  tombstoned: number;
}

export async function getStore(db: Db, domain: string): Promise<StoreDetail | null> {
  return db.first<StoreDetail>(
    `SELECT s.id, s.domain, s.name, s.url, s.country, s.currency, s.category_slug,
       c.name AS category_name, s.tranco_rank, s.is_curated, s.is_captured, s.status,
       s.opted_out_at, s.first_seen, s.last_seen, s.current_theme_name, s.current_theme_version,
       t.slug AS theme_slug, t.name AS theme_name, s.app_count, s.created_at, s.updated_at,
       EXISTS (SELECT 1 FROM store_tombstones tb WHERE tb.domain = s.domain) AS tombstoned
     FROM stores s
     LEFT JOIN themes t ON t.id = s.current_theme_id
     LEFT JOIN store_categories c ON c.slug = s.category_slug
     WHERE s.domain = ?`,
    [domain],
  );
}

export async function getStoreCategories(db: Db): Promise<Option[]> {
  const rows = await db.all<{ slug: string; name: string }>(
    'SELECT slug, name FROM store_categories ORDER BY name',
  );
  return rows.map((r) => ({ value: r.slug, label: r.name }));
}

export interface ThemeHistoryRow {
  id: number;
  raw_name: string | null;
  version: string | null;
  is_custom: number;
  theme_slug: string | null;
  theme_name: string | null;
  preset_name: string | null;
  first_seen: string;
  last_seen: string;
  replaced_at: string | null;
}

export interface AppHistoryRow {
  slug: string | null;
  name: string;
  resolved: number;
  confidence: number | null;
  first_seen: string;
  last_seen: string;
  removed_at: string | null;
}

export interface CaptureRow {
  page_type: string;
  page_url: string | null;
  device: string | null;
  screenshot_id: number | null;
  is_placeholder: number | null;
  has_r2: number | null;
  captured_at: string | null;
  height: number | null;
  sections: number;
}

export interface ScanRow {
  ran_at: string;
  rules_version: string | null;
  source: string;
  http_status: number | null;
}

export async function getStoreHistory(db: Db, storeId: number) {
  const [themes, apps, captures, scans] = await Promise.all([
    db.all<ThemeHistoryRow>(
      `SELECT st.id, st.raw_name, st.version, st.is_custom, t.slug AS theme_slug, t.name AS theme_name,
         p.name AS preset_name, st.first_seen, st.last_seen, st.replaced_at
       FROM store_themes st
       LEFT JOIN themes t ON t.id = st.theme_id
       LEFT JOIN theme_presets p ON p.id = st.preset_id
       WHERE st.store_id = ? ORDER BY st.first_seen DESC, st.id DESC`,
      [storeId],
    ),
    db.all<AppHistoryRow>(
      `SELECT * FROM (
         SELECT a.slug AS slug, a.name AS name, 1 AS resolved, sa.confidence AS confidence,
           sa.first_seen AS first_seen, sa.last_seen AS last_seen, sa.removed_at AS removed_at
         FROM store_apps sa JOIN apps a ON a.id = sa.app_id WHERE sa.store_id = ?
         UNION ALL
         SELECT NULL, su.detection_slug, 0, NULL, su.first_seen, su.last_seen, su.removed_at
         FROM store_unresolved_apps su WHERE su.store_id = ?
       ) ORDER BY removed_at IS NOT NULL, resolved DESC, name COLLATE NOCASE`,
      [storeId, storeId],
    ),
    db.all<CaptureRow>(
      `SELECT p.page_type, p.url AS page_url, sc.device, sc.id AS screenshot_id, sc.is_placeholder,
         sc.r2_key IS NOT NULL AS has_r2, sc.captured_at, sc.height,
         (SELECT COUNT(*) FROM sections se WHERE se.screenshot_id = sc.id) AS sections
       FROM pages p
       LEFT JOIN screenshots sc ON sc.page_id = p.id AND sc.is_current = 1
       WHERE p.store_id = ?
       ORDER BY CASE p.page_type WHEN 'home' THEN 0 WHEN 'collection' THEN 1 WHEN 'product' THEN 2
         WHEN 'cart' THEN 3 ELSE 4 END, p.page_type, sc.device`,
      [storeId],
    ),
    db.all<ScanRow>(
      `SELECT ran_at, rules_version, source, http_status FROM scans
       WHERE store_id = ? ORDER BY ran_at DESC LIMIT 5`,
      [storeId],
    ),
  ]);
  return { themes, apps, captures, scans };
}

// ---------------------------------------------------------------------------------------------
// Scan jobs
// ---------------------------------------------------------------------------------------------
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobRow {
  id: number;
  store_id: number | null;
  domain: string;
  store_name: string | null;
  kind: 'detect' | 'capture' | 'rescan';
  page_types_json: string | null;
  devices_json: string | null;
  priority: number;
  status: JobStatus;
  attempts: number;
  requested_by: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const JOB_COLUMNS = `j.id, j.store_id, j.domain, s.name AS store_name, j.kind, j.page_types_json,
  j.devices_json, j.priority, j.status, j.attempts, j.requested_by, j.error, j.created_at,
  j.started_at, j.finished_at`;

export async function listJobs(
  db: Db,
  status: JobStatus,
  page = 1,
): Promise<{ rows: JobRow[]; total: number; page: number }> {
  const total =
    (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM scan_jobs WHERE status = ?', [status]))
      ?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const order =
    status === 'queued'
      ? 'j.priority DESC, j.created_at ASC, j.id ASC'
      : status === 'running'
        ? 'j.started_at ASC, j.id ASC'
        : 'COALESCE(j.finished_at, j.created_at) DESC, j.id DESC';
  const rows = await db.all<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM scan_jobs j LEFT JOIN stores s ON s.id = j.store_id
     WHERE j.status = ? ORDER BY ${order} LIMIT ? OFFSET ?`,
    [status, PAGE_SIZE, (p - 1) * PAGE_SIZE],
  );
  return { rows, total, page: p };
}

export async function getStoreJobs(db: Db, storeId: number, domain: string): Promise<JobRow[]> {
  return db.all<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM scan_jobs j LEFT JOIN stores s ON s.id = j.store_id
     WHERE j.store_id = ? OR j.domain = ? ORDER BY j.id DESC LIMIT 8`,
    [storeId, domain],
  );
}

// ---------------------------------------------------------------------------------------------
// Removal requests
// ---------------------------------------------------------------------------------------------
export const REMOVAL_TABS = {
  pending: ['pending'],
  approved: ['approved', 'done'],
  rejected: ['rejected'],
} as const;
export type RemovalTab = keyof typeof REMOVAL_TABS;

export interface RemovalRow {
  id: number;
  reference: string;
  domain: string;
  email: string;
  name: string | null;
  reason: string;
  scope: 'store' | 'screenshots' | 'details';
  status: 'pending' | 'approved' | 'rejected' | 'done';
  admin_note: string | null;
  created_at: string;
  handled_at: string | null;
  store_id: number | null;
  store_name: string | null;
  store_status: string | null;
}

const REMOVAL_COLUMNS = `r.id, r.reference, r.domain, r.email, r.name, r.reason, r.scope, r.status,
  r.admin_note, r.created_at, r.handled_at, s.id AS store_id, s.name AS store_name,
  s.status AS store_status`;

export async function getRemovalCounts(db: Db): Promise<Record<RemovalTab, number>> {
  const rows = await db.all<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM removal_requests GROUP BY status',
  );
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return {
    pending: by.get('pending') ?? 0,
    approved: (by.get('approved') ?? 0) + (by.get('done') ?? 0),
    rejected: by.get('rejected') ?? 0,
  };
}

export async function listRemovals(
  db: Db,
  tab: RemovalTab,
  page = 1,
): Promise<{ rows: RemovalRow[]; total: number; page: number }> {
  const statuses = REMOVAL_TABS[tab];
  const marks = statuses.map(() => '?').join(', ');
  const total =
    (
      await db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM removal_requests WHERE status IN (${marks})`,
        [...statuses],
      )
    )?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  // Pending: oldest first (first in, first out). Handled: most recent decision first.
  const order = tab === 'pending' ? 'r.created_at ASC, r.id ASC' : 'r.handled_at DESC, r.id DESC';
  const rows = await db.all<RemovalRow>(
    `SELECT ${REMOVAL_COLUMNS} FROM removal_requests r LEFT JOIN stores s ON s.domain = r.domain
     WHERE r.status IN (${marks}) ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...statuses, PAGE_SIZE, (p - 1) * PAGE_SIZE],
  );
  return { rows, total, page: p };
}

export async function getPendingRemovals(db: Db, limit = 5): Promise<RemovalRow[]> {
  return db.all<RemovalRow>(
    `SELECT ${REMOVAL_COLUMNS} FROM removal_requests r LEFT JOIN stores s ON s.domain = r.domain
     WHERE r.status = 'pending' ORDER BY r.created_at ASC, r.id ASC LIMIT ?`,
    [limit],
  );
}

export async function getRemoval(db: Db, id: number): Promise<RemovalRow | null> {
  return db.first<RemovalRow>(
    `SELECT ${REMOVAL_COLUMNS} FROM removal_requests r LEFT JOIN stores s ON s.domain = r.domain
     WHERE r.id = ?`,
    [id],
  );
}

export interface StoreMediaSummary {
  screenshots: number;
  placeholders: number;
  r2Objects: number;
  sections: number;
  teardownsPublished: number;
  queuedJobs: number;
  tombstoned: number;
}

export async function getStoreMediaSummary(
  db: Db,
  storeId: number | null,
  domain: string,
): Promise<StoreMediaSummary> {
  const r = await db.first<StoreMediaSummary>(
    `SELECT
      (SELECT COUNT(*) FROM screenshots WHERE store_id = ?1 AND is_current = 1) AS screenshots,
      (SELECT COUNT(*) FROM screenshots WHERE store_id = ?1 AND is_current = 1 AND is_placeholder = 1) AS placeholders,
      (SELECT COUNT(*) FROM screenshots WHERE store_id = ?1 AND r2_key IS NOT NULL)
        + (SELECT COUNT(*) FROM sections WHERE store_id = ?1 AND r2_key_crop IS NOT NULL) AS r2Objects,
      (SELECT COUNT(*) FROM sections WHERE store_id = ?1 AND is_current = 1) AS sections,
      (SELECT COUNT(*) FROM teardowns WHERE store_id = ?1 AND published_at IS NOT NULL) AS teardownsPublished,
      (SELECT COUNT(*) FROM scan_jobs WHERE (store_id = ?1 OR domain = ?2) AND status = 'queued') AS queuedJobs,
      (SELECT COUNT(*) FROM store_tombstones WHERE domain = ?2) AS tombstoned`,
    [storeId ?? -1, domain],
  );
  return (
    r ?? {
      screenshots: 0,
      placeholders: 0,
      r2Objects: 0,
      sections: 0,
      teardownsPublished: 0,
      queuedJobs: 0,
      tombstoned: 0,
    }
  );
}

export async function getRemovalsForDomain(db: Db, domain: string): Promise<RemovalRow[]> {
  return db.all<RemovalRow>(
    `SELECT ${REMOVAL_COLUMNS} FROM removal_requests r LEFT JOIN stores s ON s.domain = r.domain
     WHERE r.domain = ? ORDER BY r.created_at DESC LIMIT 5`,
    [domain],
  );
}

// ---------------------------------------------------------------------------------------------
// Affiliates
// ---------------------------------------------------------------------------------------------
export interface ProgramRow {
  id: number;
  slug: string;
  name: string;
  network: string | null;
  status: string;
  links: number;
  active_links: number;
  clicks: number;
}

export async function listPrograms(db: Db): Promise<ProgramRow[]> {
  return db.all<ProgramRow>(
    `SELECT p.id, p.slug, p.name, p.network, p.status,
       (SELECT COUNT(*) FROM affiliate_links l WHERE l.program_id = p.id) AS links,
       (SELECT COUNT(*) FROM affiliate_links l WHERE l.program_id = p.id AND l.active = 1) AS active_links,
       (SELECT COALESCE(SUM(c.count), 0) FROM clicks c JOIN affiliate_links l ON l.id = c.link_id
         WHERE l.program_id = p.id) AS clicks
     FROM affiliate_programs p
     ORDER BY CASE p.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, p.name COLLATE NOCASE`,
  );
}

export interface LinkRow {
  id: number;
  target_type: 'app' | 'theme' | 'vendor';
  target_id: number | null;
  target_name: string;
  target_slug: string | null;
  program_id: number | null;
  program_name: string | null;
  url: string;
  label: string | null;
  active: number;
  clicks_total: number;
  clicks_30d: number;
  updated_at: string;
}

export async function listLinks(db: Db, now: Date): Promise<LinkRow[]> {
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  return db.all<LinkRow>(
    `SELECT l.id, l.target_type, l.target_id, l.target_name,
       CASE l.target_type
         WHEN 'app' THEN (SELECT slug FROM apps WHERE id = l.target_id)
         WHEN 'theme' THEN (SELECT slug FROM themes WHERE id = l.target_id)
       END AS target_slug,
       l.program_id, p.name AS program_name, l.url, l.label, l.active,
       (SELECT COALESCE(SUM(count), 0) FROM clicks WHERE link_id = l.id) AS clicks_total,
       (SELECT COALESCE(SUM(count), 0) FROM clicks WHERE link_id = l.id AND day >= ?) AS clicks_30d,
       l.updated_at
     FROM affiliate_links l LEFT JOIN affiliate_programs p ON p.id = l.program_id
     ORDER BY l.active DESC, l.target_type, l.target_name COLLATE NOCASE`,
    [since],
  );
}

export async function getLink(db: Db, id: number): Promise<LinkRow | null> {
  const rows = await db.all<LinkRow>(
    `SELECT l.id, l.target_type, l.target_id, l.target_name, NULL AS target_slug, l.program_id,
       p.name AS program_name, l.url, l.label, l.active, 0 AS clicks_total, 0 AS clicks_30d, l.updated_at
     FROM affiliate_links l LEFT JOIN affiliate_programs p ON p.id = l.program_id WHERE l.id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

export interface TargetOptions {
  apps: Option[];
  themes: Option[];
  vendors: Option[];
  programs: Option[];
}

export async function getLinkTargetOptions(db: Db): Promise<TargetOptions> {
  const [apps, themes, vendors, programs] = await Promise.all([
    db.all<{ id: number; name: string }>('SELECT id, name FROM apps ORDER BY name COLLATE NOCASE'),
    db.all<{ id: number; name: string }>('SELECT id, name FROM themes ORDER BY name COLLATE NOCASE'),
    db.all<{ vendor_slug: string; vendor: string }>(
      `SELECT vendor_slug, MIN(vendor) AS vendor FROM themes
       WHERE vendor_slug IS NOT NULL AND vendor IS NOT NULL GROUP BY vendor_slug ORDER BY vendor COLLATE NOCASE`,
    ),
    db.all<{ id: number; name: string; status: string }>(
      'SELECT id, name, status FROM affiliate_programs ORDER BY name COLLATE NOCASE',
    ),
  ]);
  return {
    apps: apps.map((a) => ({ value: `app:${a.id}`, label: a.name })),
    themes: themes.map((t) => ({ value: `theme:${t.id}`, label: t.name })),
    vendors: vendors.map((v) => ({ value: `vendor:${v.vendor_slug}`, label: v.vendor })),
    programs: programs.map((p) => ({ value: String(p.id), label: `${p.name} (${p.status})` })),
  };
}

// ---------------------------------------------------------------------------------------------
// Teardowns
// ---------------------------------------------------------------------------------------------
export interface TeardownRow {
  id: number;
  slug: string;
  title: string;
  published_at: string | null;
  is_sample: number;
  updated_at: string;
  domain: string;
  store_name: string | null;
  store_status: string;
  notes: number;
}

export async function listTeardowns(db: Db): Promise<TeardownRow[]> {
  return db.all<TeardownRow>(
    `SELECT t.id, t.slug, t.title, t.published_at, t.is_sample, t.updated_at, s.domain,
       s.name AS store_name, s.status AS store_status,
       (SELECT COUNT(*) FROM teardown_notes n WHERE n.teardown_id = t.id) AS notes
     FROM teardowns t JOIN stores s ON s.id = t.store_id
     ORDER BY t.published_at IS NULL DESC, t.published_at DESC, t.updated_at DESC`,
  );
}

// ---------------------------------------------------------------------------------------------
// Themes and apps
// ---------------------------------------------------------------------------------------------
export interface ThemeRow {
  id: number;
  slug: string;
  name: string;
  vendor: string | null;
  price_label: string | null;
  price_cents: number | null;
  marketplace: string | null;
  official_url: string | null;
  status: 'active' | 'hidden' | 'retired';
  store_count: number | null;
  curated_store_count: number | null;
  updated_at: string;
}

export async function listThemes(db: Db, q?: string): Promise<ThemeRow[]> {
  const term = q?.trim().toLowerCase();
  return db.all<ThemeRow>(
    `SELECT t.id, t.slug, t.name, t.vendor, t.price_label, t.price_cents, t.marketplace,
       t.official_url, t.status, ts.store_count, ts.curated_store_count, t.updated_at
     FROM themes t LEFT JOIN theme_stats ts ON ts.theme_id = t.id
     ${term ? `WHERE lower(t.name) LIKE ? ESCAPE '\\' OR lower(COALESCE(t.vendor, '')) LIKE ? ESCAPE '\\'` : ''}
     ORDER BY COALESCE(ts.store_count, -1) DESC, t.name COLLATE NOCASE`,
    term ? [likePattern(term), likePattern(term)] : [],
  );
}

export interface AppRow {
  id: number;
  slug: string;
  name: string;
  developer: string | null;
  tagline: string | null;
  category_id: number | null;
  category_name: string | null;
  profile: 'full' | 'basic';
  status: 'active' | 'hidden' | 'delisted';
  store_count: number | null;
  updated_at: string;
}

export interface AppFilters {
  q?: string;
  category?: string;
  status?: 'active' | 'hidden' | 'delisted';
  page?: number;
}

export async function listApps(
  db: Db,
  f: AppFilters,
): Promise<{ rows: AppRow[]; total: number; page: number }> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  const q = f.q?.trim().toLowerCase();
  if (q) {
    where.push(
      `(lower(a.name) LIKE ? ESCAPE '\\' OR a.slug LIKE ? ESCAPE '\\' OR lower(COALESCE(a.developer, '')) LIKE ? ESCAPE '\\')`,
    );
    params.push(likePattern(q), likePattern(q), likePattern(q));
  }
  if (f.category === 'none') where.push('a.category_id IS NULL');
  else if (f.category) {
    where.push('c.slug = ?');
    params.push(f.category);
  }
  if (f.status) {
    where.push('a.status = ?');
    params.push(f.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM apps a LEFT JOIN app_categories c ON c.id = a.category_id
    LEFT JOIN app_stats st ON st.app_id = a.id`;
  const total = (await db.first<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${whereSql}`, params))?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  const rows = await db.all<AppRow>(
    `SELECT a.id, a.slug, a.name, a.developer, a.tagline, a.category_id, c.name AS category_name,
       a.profile, a.status, st.store_count, a.updated_at
     ${from} ${whereSql}
     ORDER BY COALESCE(st.store_count, -1) DESC, a.name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  return { rows, total, page };
}

export async function getAppCategories(db: Db): Promise<Array<Option & { id: number }>> {
  const rows = await db.all<{ id: number; slug: string; name: string }>(
    'SELECT id, slug, name FROM app_categories ORDER BY position, name',
  );
  return rows.map((r) => ({ id: r.id, value: r.slug, label: r.name }));
}
