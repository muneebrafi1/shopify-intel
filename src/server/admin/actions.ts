/**
 * Admin mutations. Each one validates its input, applies the change and writes an audit row in
 * the same atomic batch, and returns a flash key for the redirect (see flash.ts).
 *
 * Changes that affect public counts (store status/curation, opt-outs, theme/app visibility)
 * rebuild the derived tables afterwards (src/server/repo/maintenance.ts).
 */
import type { Db, Statement } from '../db/types.ts';
import { rebuildDerived } from '../repo/maintenance.ts';
import { normalizeDomain } from '../lib/slug.ts';
import { auditStatement, diffFields } from './audit.ts';

/** The subset of an R2 bucket the admin needs (R2Bucket satisfies it). */
export interface MediaStore {
  delete(keys: string | string[]): Promise<void>;
}

export interface ActionContext {
  db: Db;
  actor: string;
  now: Date;
  media?: MediaStore | null;
}

export interface ActionResult {
  ok: boolean;
  /** Key into FLASH (flash.ts). */
  flash: string;
  /** Optional number shown in the flash message (e.g. deleted objects). */
  n?: number;
}

const ok = (flash: string, n?: number): ActionResult => ({ ok: true, flash, n });
const fail = (flash: string): ActionResult => ({ ok: false, flash });

/** Rebuild failures must not hide that the change itself was saved. */
async function rebuild(db: Db): Promise<boolean> {
  try {
    await rebuildDerived(db);
    return true;
  } catch (err) {
    console.error('admin: rebuildDerived failed', err);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------
export interface StoreUpdate {
  name: string | null;
  category: string | null;
  country: string | null;
  status: 'active' | 'hidden' | null;
  curated: boolean;
}

export async function updateStore(ctx: ActionContext, domain: string, input: StoreUpdate) {
  const { db, now } = ctx;
  const store = await db.first<{
    id: number;
    name: string | null;
    category_slug: string | null;
    country: string | null;
    status: string;
    is_curated: number;
  }>('SELECT id, name, category_slug, country, status, is_curated FROM stores WHERE domain = ?', [
    domain,
  ]);
  if (!store) return fail('not_found');

  const country = input.country ? input.country.toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) return fail('bad_country');
  if (input.category) {
    const cat = await db.first('SELECT 1 AS x FROM store_categories WHERE slug = ?', [
      input.category,
    ]);
    if (!cat) return fail('bad_category');
  }
  // Opted-out stores keep that status: only an approved removal sets it, nothing here undoes it.
  const status = store.status === 'opted_out' ? 'opted_out' : (input.status ?? store.status);

  const next = {
    name: input.name,
    category_slug: input.category,
    country,
    status,
    is_curated: input.curated ? 1 : 0,
  };
  const changes = diffFields(store, next);
  if (Object.keys(changes).length === 0) return ok('no_changes');

  await db.batch([
    {
      sql: `UPDATE stores SET name = ?, category_slug = ?, country = ?, status = ?, is_curated = ?,
              updated_at = ? WHERE id = ?`,
      params: [
        next.name,
        next.category_slug,
        next.country,
        next.status,
        next.is_curated,
        now.toISOString(),
        store.id,
      ],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'store.update',
        targetType: 'store',
        targetId: domain,
        detail: changes,
      },
      now,
    ),
  ]);
  if ('status' in changes || 'is_curated' in changes) {
    if (!(await rebuild(db))) return ok('saved_rebuild_failed');
  }
  return ok('saved');
}

// ---------------------------------------------------------------------------------------------
// Scan / capture jobs
// ---------------------------------------------------------------------------------------------
export type JobKind = 'detect' | 'capture' | 'rescan';

export async function queueJob(
  ctx: ActionContext,
  input: { domain: string; kind: JobKind; priority?: number },
): Promise<ActionResult> {
  const { db, now } = ctx;
  const domain = normalizeDomain(input.domain);
  if (!domain) return fail('bad_domain');

  const [store, tomb] = await Promise.all([
    db.first<{ id: number; status: string }>('SELECT id, status FROM stores WHERE domain = ?', [
      domain,
    ]),
    db.first('SELECT 1 AS x FROM store_tombstones WHERE domain = ?', [domain]),
  ]);
  if (tomb || store?.status === 'opted_out') return fail('opted_out');
  if (!store && input.kind !== 'detect') return fail('unknown_store');

  const open = await db.first<{ id: number }>(
    `SELECT id FROM scan_jobs WHERE domain = ? AND kind = ? AND status IN ('queued', 'running') LIMIT 1`,
    [domain, input.kind],
  );
  if (open) return fail('already_queued');

  await db.batch([
    {
      sql: `INSERT INTO scan_jobs (store_id, domain, kind, page_types_json, devices_json, priority, status,
              attempts, requested_by, created_at)
            VALUES (?, ?, ?, NULL, NULL, ?, 'queued', 0, ?, ?)`,
      params: [
        store?.id ?? null,
        domain,
        input.kind,
        input.priority ?? 10,
        ctx.actor,
        now.toISOString(),
      ],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action:
          input.kind === 'capture'
            ? 'store.queue_capture'
            : input.kind === 'rescan'
              ? 'store.queue_rescan'
              : 'job.queue',
        targetType: 'store',
        targetId: domain,
        detail: { kind: input.kind },
      },
      now,
    ),
  ]);
  return ok(input.kind === 'capture' ? 'queued_capture' : 'queued_rescan');
}

export async function cancelJob(ctx: ActionContext, id: number): Promise<ActionResult> {
  const { db, now } = ctx;
  const job = await db.first<{ id: number; domain: string; status: string; kind: string }>(
    'SELECT id, domain, status, kind FROM scan_jobs WHERE id = ?',
    [id],
  );
  if (!job) return fail('not_found');
  if (job.status !== 'queued') return fail('not_cancellable');
  const [res] = await db.batch([
    {
      sql: `UPDATE scan_jobs SET status = 'cancelled', finished_at = ?, error = 'Cancelled by admin'
            WHERE id = ? AND status = 'queued'`,
      params: [now.toISOString(), id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'job.cancel',
        targetType: 'store',
        targetId: job.domain,
        detail: { job: id, kind: job.kind },
      },
      now,
    ),
  ]);
  return res && res.changes > 0 ? ok('cancelled') : fail('not_cancellable');
}

// ---------------------------------------------------------------------------------------------
// Removal requests
// ---------------------------------------------------------------------------------------------
interface RemovalRecord {
  id: number;
  reference: string;
  domain: string;
  scope: 'store' | 'screenshots' | 'details';
  status: 'pending' | 'approved' | 'rejected' | 'done';
}

async function loadRemoval(db: Db, id: number) {
  const req = await db.first<RemovalRecord>(
    'SELECT id, reference, domain, scope, status FROM removal_requests WHERE id = ?',
    [id],
  );
  if (!req) return null;
  const domain = normalizeDomain(req.domain) ?? req.domain.trim().toLowerCase();
  const store = await db.first<{ id: number; status: string }>(
    'SELECT id, status FROM stores WHERE domain = ?',
    [domain],
  );
  return { req, domain, store };
}

/** Every R2 object stored for a store (captured screenshots and pre-cut section crops). */
async function mediaKeysFor(db: Db, storeId: number): Promise<string[]> {
  const rows = await db.all<{ k: string }>(
    `SELECT r2_key AS k FROM screenshots WHERE store_id = ? AND r2_key IS NOT NULL
     UNION
     SELECT r2_key_crop AS k FROM sections WHERE store_id = ? AND r2_key_crop IS NOT NULL`,
    [storeId, storeId],
  );
  return rows.map((r) => r.k).filter((k) => typeof k === 'string' && k.length > 0);
}

/**
 * Deletes the store's R2 objects, then clears the keys and marks the request done.
 * Placeholder captures have no R2 objects, so there may be nothing to delete.
 */
async function deleteStoreMedia(
  ctx: ActionContext,
  req: RemovalRecord,
  storeId: number | null,
  domain: string,
): Promise<ActionResult> {
  const { db, now } = ctx;
  const keys = storeId ? await mediaKeysFor(db, storeId) : [];
  if (keys.length > 0) {
    if (!ctx.media) {
      await db.batch([
        auditStatement(
          {
            actor: ctx.actor,
            action: 'removal.media_failed',
            targetType: 'removal',
            targetId: req.id,
            detail: { reason: 'MEDIA binding missing', objects: keys.length },
          },
          now,
        ),
      ]);
      return fail('media_unavailable');
    }
    try {
      for (let i = 0; i < keys.length; i += 1000) await ctx.media.delete(keys.slice(i, i + 1000));
    } catch (err) {
      console.error('admin: R2 delete failed', err);
      await db.batch([
        auditStatement(
          {
            actor: ctx.actor,
            action: 'removal.media_failed',
            targetType: 'removal',
            targetId: req.id,
            detail: { objects: keys.length },
          },
          now,
        ),
      ]);
      return fail('media_failed');
    }
  }
  const statements: Statement[] = [];
  if (storeId) {
    statements.push(
      {
        sql: 'UPDATE screenshots SET r2_key = NULL WHERE store_id = ? AND r2_key IS NOT NULL',
        params: [storeId],
      },
      {
        sql: 'UPDATE sections SET r2_key_crop = NULL WHERE store_id = ? AND r2_key_crop IS NOT NULL',
        params: [storeId],
      },
    );
  }
  statements.push(
    {
      sql: `UPDATE removal_requests SET status = 'done', handled_at = COALESCE(handled_at, ?) WHERE id = ?`,
      params: [now.toISOString(), req.id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: keys.length ? 'removal.media_deleted' : 'removal.complete',
        targetType: 'removal',
        targetId: req.id,
        detail: { domain, objects: keys.length },
      },
      now,
    ),
  );
  await db.batch(statements);
  return ok('removal_done', keys.length);
}

/**
 * Approve a removal request.
 *   scope 'store'       → store status opted_out (+ opted_out_at), tombstone, unpublish its
 *                         teardowns, cancel queued jobs, retire screenshots/sections, delete R2.
 *   scope 'screenshots' → retire screenshots/sections and delete R2; the store stays listed.
 *   scope 'details'     → the admin edits the store by hand; the request is marked done.
 * The request is 'approved' while media deletion is outstanding and 'done' once it succeeded.
 */
export async function approveRemoval(
  ctx: ActionContext,
  id: number,
  input: { note: string | null; confirmed: boolean },
): Promise<ActionResult> {
  const { db, now } = ctx;
  if (!input.confirmed) return fail('confirm_required');
  const loaded = await loadRemoval(db, id);
  if (!loaded) return fail('not_found');
  const { req, domain, store } = loaded;
  if (req.status !== 'pending') return fail('already_handled');
  const ts = now.toISOString();

  const statements: Statement[] = [];
  if (req.scope === 'store') {
    if (store) {
      statements.push(
        {
          sql: `UPDATE stores SET status = 'opted_out', opted_out_at = COALESCE(opted_out_at, ?), updated_at = ? WHERE id = ?`,
          params: [ts, ts, store.id],
        },
        {
          sql: 'UPDATE teardowns SET published_at = NULL, updated_at = ? WHERE store_id = ? AND published_at IS NOT NULL',
          params: [ts, store.id],
        },
      );
    }
    statements.push(
      {
        sql: `INSERT INTO store_tombstones (domain, reason, removal_request_id, created_at)
              VALUES (?, 'removal-request', ?, ?)
              ON CONFLICT (domain) DO UPDATE SET removal_request_id = excluded.removal_request_id`,
        params: [domain, req.id, ts],
      },
      {
        sql: `UPDATE scan_jobs SET status = 'cancelled', finished_at = ?, error = 'Store opted out'
              WHERE (domain = ? OR store_id = ?) AND status = 'queued'`,
        params: [ts, domain, store?.id ?? -1],
      },
    );
  }
  if ((req.scope === 'store' || req.scope === 'screenshots') && store) {
    statements.push(
      { sql: 'UPDATE screenshots SET is_current = 0 WHERE store_id = ?', params: [store.id] },
      { sql: 'UPDATE sections SET is_current = 0 WHERE store_id = ?', params: [store.id] },
    );
  }
  statements.push(
    {
      sql: `UPDATE removal_requests SET status = ?, handled_at = ?, admin_note = ? WHERE id = ? AND status = 'pending'`,
      params: [req.scope === 'details' ? 'done' : 'approved', ts, input.note, req.id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'removal.approve',
        targetType: 'removal',
        targetId: req.id,
        detail: {
          reference: req.reference,
          domain,
          scope: req.scope,
          store_found: !!store,
          note: input.note,
        },
      },
      now,
    ),
  );
  await db.batch(statements);

  if (req.scope === 'details') return ok('removal_details_done');
  // Hidden everywhere first (above); then the media, then the derived counts and search index.
  const media = await deleteStoreMedia(ctx, req, store?.id ?? null, domain);
  const rebuilt = await rebuild(db);
  if (!media.ok) return media;
  return rebuilt ? media : ok('saved_rebuild_failed');
}

/** Retry the R2 cleanup for an approved request whose media deletion failed earlier. */
export async function retryRemovalMedia(ctx: ActionContext, id: number): Promise<ActionResult> {
  const loaded = await loadRemoval(ctx.db, id);
  if (!loaded) return fail('not_found');
  if (loaded.req.status !== 'approved') return fail('already_handled');
  return deleteStoreMedia(ctx, loaded.req, loaded.store?.id ?? null, loaded.domain);
}

export async function rejectRemoval(
  ctx: ActionContext,
  id: number,
  input: { note: string | null },
): Promise<ActionResult> {
  const { db, now } = ctx;
  if (!input.note || input.note.length < 3) return fail('note_required');
  const req = await db.first<RemovalRecord>(
    'SELECT id, reference, domain, scope, status FROM removal_requests WHERE id = ?',
    [id],
  );
  if (!req) return fail('not_found');
  if (req.status !== 'pending') return fail('already_handled');
  await db.batch([
    {
      sql: `UPDATE removal_requests SET status = 'rejected', handled_at = ?, admin_note = ? WHERE id = ? AND status = 'pending'`,
      params: [now.toISOString(), input.note, id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'removal.reject',
        targetType: 'removal',
        targetId: id,
        detail: { reference: req.reference, domain: req.domain, note: input.note },
      },
      now,
    ),
  ]);
  return ok('removal_rejected');
}

// ---------------------------------------------------------------------------------------------
// Affiliates (public referral URLs: data, not secrets)
// ---------------------------------------------------------------------------------------------
export interface LinkInput {
  url: string;
  label: string | null;
  programId: number | null;
  active: boolean;
}

async function programExists(db: Db, id: number | null) {
  return (
    id === null || !!(await db.first('SELECT 1 AS x FROM affiliate_programs WHERE id = ?', [id]))
  );
}

export async function updateLink(
  ctx: ActionContext,
  id: number,
  input: LinkInput,
): Promise<ActionResult> {
  const { db, now } = ctx;
  const link = await db.first<{
    id: number;
    url: string;
    label: string | null;
    program_id: number | null;
    active: number;
    target_name: string;
  }>('SELECT id, url, label, program_id, active, target_name FROM affiliate_links WHERE id = ?', [
    id,
  ]);
  if (!link) return fail('not_found');
  if (!(await programExists(db, input.programId))) return fail('bad_program');
  const next = {
    url: input.url,
    label: input.label,
    program_id: input.programId,
    active: input.active ? 1 : 0,
  };
  const changes = diffFields(link, next);
  if (Object.keys(changes).length === 0) return ok('no_changes');
  await db.batch([
    {
      sql: 'UPDATE affiliate_links SET url = ?, label = ?, program_id = ?, active = ?, updated_at = ? WHERE id = ?',
      params: [next.url, next.label, next.program_id, next.active, now.toISOString(), id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'affiliate_link.update',
        targetType: 'affiliate_link',
        targetId: id,
        detail: { target: link.target_name, ...changes },
      },
      now,
    ),
  ]);
  return ok('saved');
}

export async function createLink(
  ctx: ActionContext,
  input: LinkInput & { target: string },
): Promise<ActionResult & { id?: number }> {
  const { db, now } = ctx;
  const m = /^(app|theme|vendor):([a-z0-9-]{1,80})$/.exec(input.target);
  if (!m) return fail('bad_target');
  const [, type, ref] = m as unknown as [string, 'app' | 'theme' | 'vendor', string];
  let targetId: number | null = null;
  let targetName: string | null = null;
  if (type === 'app' || type === 'theme') {
    const row = await db.first<{ id: number; name: string }>(
      `SELECT id, name FROM ${type === 'app' ? 'apps' : 'themes'} WHERE id = ?`,
      [Number(ref)],
    );
    if (!row) return fail('bad_target');
    targetId = row.id;
    targetName = row.name;
  } else {
    const row = await db.first<{ vendor: string }>(
      'SELECT MIN(vendor) AS vendor FROM themes WHERE vendor_slug = ? AND vendor IS NOT NULL',
      [ref],
    );
    if (!row?.vendor) return fail('bad_target');
    targetName = row.vendor;
  }
  if (!(await programExists(db, input.programId))) return fail('bad_program');
  const ts = now.toISOString();
  const [res] = await db.batch([
    {
      sql: `INSERT INTO affiliate_links (target_type, target_id, target_name, program_id, url, label, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        type,
        targetId,
        targetName,
        input.programId,
        input.url,
        input.label,
        input.active ? 1 : 0,
        ts,
        ts,
      ],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'affiliate_link.create',
        targetType: 'affiliate_link',
        targetId: null,
        detail: { target_type: type, target: targetName, url: input.url },
      },
      now,
    ),
  ]);
  return { ...ok('link_created'), id: res?.lastRowId ?? undefined };
}

export const PROGRAM_STATUSES = [
  'approved',
  'pending',
  'signed-up',
  'not-applied',
  'not-submitted',
  'on-hold',
  'blocked',
  'not-eligible',
  'not-available',
  'no-public-program',
  'no-program',
  'not-found',
  'unreachable',
] as const;

export async function updateProgramStatus(
  ctx: ActionContext,
  id: number,
  status: string,
): Promise<ActionResult> {
  const { db, now } = ctx;
  if (!/^[a-z][a-z-]{1,30}$/.test(status)) return fail('bad_request');
  const program = await db.first<{ id: number; name: string; status: string }>(
    'SELECT id, name, status FROM affiliate_programs WHERE id = ?',
    [id],
  );
  if (!program) return fail('not_found');
  if (program.status === status) return ok('no_changes');
  await db.batch([
    { sql: 'UPDATE affiliate_programs SET status = ? WHERE id = ?', params: [status, id] },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'affiliate_program.update',
        targetType: 'affiliate_program',
        targetId: id,
        detail: { program: program.name, status: [program.status, status] },
      },
      now,
    ),
  ]);
  return ok('saved');
}

// ---------------------------------------------------------------------------------------------
// Teardowns
// ---------------------------------------------------------------------------------------------
export async function setTeardownPublished(
  ctx: ActionContext,
  id: number,
  publish: boolean,
): Promise<ActionResult> {
  const { db, now } = ctx;
  const t = await db.first<{
    id: number;
    slug: string;
    published_at: string | null;
    store_status: string;
  }>(
    `SELECT t.id, t.slug, t.published_at, s.status AS store_status
     FROM teardowns t JOIN stores s ON s.id = t.store_id WHERE t.id = ?`,
    [id],
  );
  if (!t) return fail('not_found');
  if (publish && t.store_status !== 'active') return fail('store_not_active');
  if (publish === (t.published_at !== null)) return ok('no_changes');
  const ts = now.toISOString();
  await db.batch([
    {
      sql: 'UPDATE teardowns SET published_at = ?, updated_at = ? WHERE id = ?',
      params: [publish ? ts.slice(0, 10) : null, ts, id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: publish ? 'teardown.publish' : 'teardown.unpublish',
        targetType: 'teardown',
        targetId: t.slug,
        detail: null,
      },
      now,
    ),
  ]);
  return ok(publish ? 'published' : 'unpublished');
}

// ---------------------------------------------------------------------------------------------
// Themes and apps
// ---------------------------------------------------------------------------------------------
export async function updateTheme(
  ctx: ActionContext,
  id: number,
  input: {
    name?: string;
    priceLabel?: string | null;
    marketplace?: string | null;
    status?: 'active' | 'hidden';
  },
): Promise<ActionResult> {
  const { db, now } = ctx;
  const theme = await db.first<{
    id: number;
    slug: string;
    name: string;
    price_label: string | null;
    marketplace: string | null;
    status: string;
  }>('SELECT id, slug, name, price_label, marketplace, status FROM themes WHERE id = ?', [id]);
  if (!theme) return fail('not_found');
  if (input.name !== undefined && !input.name) return fail('name_required');
  const next = {
    name: input.name ?? theme.name,
    price_label: input.priceLabel === undefined ? theme.price_label : input.priceLabel,
    marketplace: input.marketplace === undefined ? theme.marketplace : input.marketplace,
    status: input.status ?? theme.status,
  };
  const changes = diffFields(theme, next);
  if (Object.keys(changes).length === 0) return ok('no_changes');
  await db.batch([
    {
      sql: 'UPDATE themes SET name = ?, price_label = ?, marketplace = ?, status = ?, updated_at = ? WHERE id = ?',
      params: [next.name, next.price_label, next.marketplace, next.status, now.toISOString(), id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'theme.update',
        targetType: 'theme',
        targetId: theme.slug,
        detail: changes,
      },
      now,
    ),
  ]);
  if ('status' in changes || 'name' in changes) {
    if (!(await rebuild(db))) return ok('saved_rebuild_failed');
  }
  return ok('status' in changes ? (next.status === 'hidden' ? 'hidden' : 'unhidden') : 'saved');
}

export async function updateApp(
  ctx: ActionContext,
  id: number,
  input: {
    name?: string;
    categoryId?: number | null;
    tagline?: string | null;
    status?: 'active' | 'hidden';
  },
): Promise<ActionResult> {
  const { db, now } = ctx;
  const app = await db.first<{
    id: number;
    slug: string;
    name: string;
    category_id: number | null;
    tagline: string | null;
    status: string;
  }>('SELECT id, slug, name, category_id, tagline, status FROM apps WHERE id = ?', [id]);
  if (!app) return fail('not_found');
  if (input.name !== undefined && !input.name) return fail('name_required');
  if (input.categoryId) {
    const cat = await db.first('SELECT 1 AS x FROM app_categories WHERE id = ?', [
      input.categoryId,
    ]);
    if (!cat) return fail('bad_category');
  }
  const next = {
    name: input.name ?? app.name,
    category_id: input.categoryId === undefined ? app.category_id : input.categoryId,
    tagline: input.tagline === undefined ? app.tagline : input.tagline,
    status: input.status ?? app.status,
  };
  const changes = diffFields(app, next);
  if (Object.keys(changes).length === 0) return ok('no_changes');
  await db.batch([
    {
      sql: 'UPDATE apps SET name = ?, category_id = ?, tagline = ?, status = ?, updated_at = ? WHERE id = ?',
      params: [next.name, next.category_id, next.tagline, next.status, now.toISOString(), id],
    },
    auditStatement(
      {
        actor: ctx.actor,
        action: 'app.update',
        targetType: 'app',
        targetId: app.slug,
        detail: changes,
      },
      now,
    ),
  ]);
  if ('status' in changes || 'name' in changes || 'category_id' in changes) {
    if (!(await rebuild(db))) return ok('saved_rebuild_failed');
  }
  return ok('status' in changes ? (next.status === 'hidden' ? 'hidden' : 'unhidden') : 'saved');
}
