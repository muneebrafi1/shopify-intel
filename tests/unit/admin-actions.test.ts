/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  approveRemoval,
  cancelJob,
  createLink,
  queueJob,
  rejectRemoval,
  retryRemovalMedia,
  setTeardownPublished,
  updateApp,
  updateLink,
  updateStore,
  updateTheme,
  type ActionContext,
  type MediaStore,
} from '../../src/server/admin/actions.ts';
import { flashHref, readFlash } from '../../src/server/admin/flash.ts';
import { getOverviewCounts, listStores, likePattern } from '../../src/server/admin/queries.ts';
import type { NodeDb } from '../../src/server/db/node-sqlite.ts';
import { FIXED_NOW, seededDb } from './helpers/db.ts';

let db: NodeDb;
let deleted: string[];
let media: MediaStore;
const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  db,
  actor: 'admin',
  now: FIXED_NOW,
  media,
  ...over,
});

const audit = (action: string) =>
  db.all<{ actor: string; target_id: string | null; detail_json: string | null }>(
    'SELECT actor, target_id, detail_json FROM admin_audit WHERE action = ? ORDER BY id',
    [action],
  );

async function addRemoval(
  domain: string,
  scope: 'store' | 'screenshots' | 'details' = 'store',
): Promise<number> {
  const res = await db.run(
    `INSERT INTO removal_requests (reference, domain, email, name, reason, scope, status, created_at)
     VALUES (?, ?, 'owner@example.com', 'Owner', 'Please remove our store from the site.', ?, 'pending', ?)`,
    [
      `RR-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      domain,
      scope,
      FIXED_NOW.toISOString(),
    ],
  );
  return res.lastRowId!;
}

/** A curated store with screenshots; give two of them real R2 keys and one a crop. */
async function storeWithMedia() {
  const store = await db.first<{ id: number; domain: string }>(
    `SELECT s.id, s.domain FROM stores s WHERE s.is_curated = 1
     AND EXISTS (SELECT 1 FROM teardowns t WHERE t.store_id = s.id) LIMIT 1`,
  );
  if (!store) throw new Error('seed has no curated store with a teardown');
  const shots = await db.all<{ id: number }>(
    'SELECT id FROM screenshots WHERE store_id = ? LIMIT 2',
    [store.id],
  );
  for (const [i, s] of shots.entries()) {
    await db.run('UPDATE screenshots SET r2_key = ?, is_placeholder = 0 WHERE id = ?', [
      `shots/${store.domain}/${i}.webp`,
      s.id,
    ]);
  }
  const section = await db.first<{ id: number }>(
    'SELECT id FROM sections WHERE store_id = ? LIMIT 1',
    [store.id],
  );
  await db.run('UPDATE sections SET r2_key_crop = ? WHERE id = ?', [
    `crops/${store.domain}/0.webp`,
    section!.id,
  ]);
  return store;
}

beforeEach(() => {
  db = seededDb();
  deleted = [];
  media = {
    async delete(keys) {
      deleted.push(...(Array.isArray(keys) ? keys : [keys]));
    },
  };
});
afterEach(() => db.close());

describe('removal requests', () => {
  it('approving a whole-store request opts it out everywhere and deletes its media', async () => {
    const store = await storeWithMedia();
    await queueJob(ctx(), { domain: store.domain, kind: 'rescan' });
    const id = await addRemoval(store.domain);
    const activeBefore = (await getOverviewCounts(db)).storesActive;

    expect(
      await approveRemoval(ctx(), id, { note: 'Verified by email', confirmed: false }),
    ).toMatchObject({ ok: false, flash: 'confirm_required' });

    const result = await approveRemoval(ctx(), id, { note: 'Verified by email', confirmed: true });
    expect(result).toEqual({ ok: true, flash: 'removal_done', n: 3 });
    expect(deleted.sort()).toEqual([
      `crops/${store.domain}/0.webp`,
      `shots/${store.domain}/0.webp`,
      `shots/${store.domain}/1.webp`,
    ]);

    const s = await db.first<{ status: string; opted_out_at: string | null }>(
      'SELECT status, opted_out_at FROM stores WHERE id = ?',
      [store.id],
    );
    expect(s).toEqual({ status: 'opted_out', opted_out_at: FIXED_NOW.toISOString() });
    expect(
      await db.first('SELECT removal_request_id FROM store_tombstones WHERE domain = ?', [
        store.domain,
      ]),
    ).toEqual({ removal_request_id: id });
    expect(
      await db.first(
        'SELECT COUNT(*) AS n FROM screenshots WHERE store_id = ? AND (is_current = 1 OR r2_key IS NOT NULL)',
        [store.id],
      ),
    ).toEqual({ n: 0 });
    expect(
      await db.first(
        'SELECT COUNT(*) AS n FROM sections WHERE store_id = ? AND (is_current = 1 OR r2_key_crop IS NOT NULL)',
        [store.id],
      ),
    ).toEqual({ n: 0 });
    expect(
      await db.first(
        'SELECT COUNT(*) AS n FROM teardowns WHERE store_id = ? AND published_at IS NOT NULL',
        [store.id],
      ),
    ).toEqual({ n: 0 });
    expect(
      await db.first("SELECT COUNT(*) AS n FROM scan_jobs WHERE domain = ? AND status = 'queued'", [
        store.domain,
      ]),
    ).toEqual({ n: 0 });
    expect(
      await db.first('SELECT status, admin_note, handled_at FROM removal_requests WHERE id = ?', [
        id,
      ]),
    ).toEqual({
      status: 'done',
      admin_note: 'Verified by email',
      handled_at: FIXED_NOW.toISOString(),
    });
    // Derived data was rebuilt: the store no longer counts and is gone from search.
    expect((await getOverviewCounts(db)).storesActive).toBe(activeBefore - 1);
    expect(
      await db.first("SELECT COUNT(*) AS n FROM search_index WHERE kind = 'store' AND ref = ?", [
        store.domain,
      ]),
    ).toEqual({ n: 0 });
    // Audited, and the action cannot run twice.
    expect(await audit('removal.approve')).toHaveLength(1);
    expect(await audit('removal.media_deleted')).toHaveLength(1);
    expect(await approveRemoval(ctx(), id, { note: null, confirmed: true })).toMatchObject({
      ok: false,
      flash: 'already_handled',
    });
    // Tombstoned domains cannot be queued again.
    expect(await queueJob(ctx(), { domain: store.domain, kind: 'detect' })).toMatchObject({
      ok: false,
      flash: 'opted_out',
    });
  });

  it('keeps the request "approved" when media deletion fails, and retry completes it', async () => {
    const store = await storeWithMedia();
    const id = await addRemoval(store.domain);
    const failing: MediaStore = {
      async delete() {
        throw new Error('R2 unavailable');
      },
    };
    expect(
      await approveRemoval(ctx({ media: failing }), id, { note: null, confirmed: true }),
    ).toMatchObject({ ok: false, flash: 'media_failed' });
    expect(await db.first('SELECT status FROM removal_requests WHERE id = ?', [id])).toEqual({
      status: 'approved',
    });
    expect(await db.first('SELECT status FROM stores WHERE id = ?', [store.id])).toEqual({
      status: 'opted_out',
    });
    expect(await audit('removal.media_failed')).toHaveLength(1);

    expect(await retryRemovalMedia(ctx(), id)).toEqual({ ok: true, flash: 'removal_done', n: 3 });
    expect(await db.first('SELECT status FROM removal_requests WHERE id = ?', [id])).toEqual({
      status: 'done',
    });
  });

  it('reports a missing MEDIA binding instead of pretending images were deleted', async () => {
    const store = await storeWithMedia();
    const id = await addRemoval(store.domain);
    expect(
      await approveRemoval(ctx({ media: null }), id, { note: null, confirmed: true }),
    ).toMatchObject({ ok: false, flash: 'media_unavailable' });
    expect(await db.first('SELECT status FROM removal_requests WHERE id = ?', [id])).toEqual({
      status: 'approved',
    });
  });

  it('tombstones a domain that is not in the library (placeholders have no media)', async () => {
    const id = await addRemoval('not-in-library.example');
    expect(await approveRemoval(ctx(), id, { note: null, confirmed: true })).toEqual({
      ok: true,
      flash: 'removal_done',
      n: 0,
    });
    expect(deleted).toEqual([]);
    expect(
      await db.first('SELECT domain FROM store_tombstones WHERE domain = ?', [
        'not-in-library.example',
      ]),
    ).not.toBeNull();
  });

  it('screenshots scope retires media but keeps the store listed', async () => {
    const store = await storeWithMedia();
    const id = await addRemoval(store.domain, 'screenshots');
    expect(await approveRemoval(ctx(), id, { note: null, confirmed: true })).toMatchObject({
      ok: true,
      n: 3,
    });
    expect(await db.first('SELECT status FROM stores WHERE id = ?', [store.id])).toEqual({
      status: 'active',
    });
    expect(
      await db.first('SELECT domain FROM store_tombstones WHERE domain = ?', [store.domain]),
    ).toBeNull();
    expect(
      await db.first(
        'SELECT COUNT(*) AS n FROM screenshots WHERE store_id = ? AND is_current = 1',
        [store.id],
      ),
    ).toEqual({ n: 0 });
  });

  it('details scope is marked done without touching the store', async () => {
    const store = await storeWithMedia();
    const id = await addRemoval(store.domain, 'details');
    expect(await approveRemoval(ctx(), id, { note: 'Fixed the name', confirmed: true })).toEqual({
      ok: true,
      flash: 'removal_details_done',
      n: undefined,
    });
    expect(deleted).toEqual([]);
    expect(await db.first('SELECT status FROM removal_requests WHERE id = ?', [id])).toEqual({
      status: 'done',
    });
    expect(await db.first('SELECT status FROM stores WHERE id = ?', [store.id])).toEqual({
      status: 'active',
    });
  });

  it('rejecting needs a note and is audited', async () => {
    const id = await addRemoval('youngla.com');
    expect(await rejectRemoval(ctx(), id, { note: null })).toMatchObject({
      ok: false,
      flash: 'note_required',
    });
    expect(
      await rejectRemoval(ctx(), id, { note: 'Email does not match the domain' }),
    ).toMatchObject({ ok: true, flash: 'removal_rejected' });
    expect(
      await db.first('SELECT status, admin_note FROM removal_requests WHERE id = ?', [id]),
    ).toEqual({
      status: 'rejected',
      admin_note: 'Email does not match the domain',
    });
    expect(await db.first("SELECT status FROM stores WHERE domain = 'youngla.com'")).toEqual({
      status: 'active',
    });
    expect(await audit('removal.reject')).toHaveLength(1);
  });
});

describe('stores and jobs', () => {
  it('edits a store, writes a diff to the audit log and rebuilds counts when hiding', async () => {
    const before = (await getOverviewCounts(db)).storesActive;
    const result = await updateStore(ctx(), 'youngla.com', {
      name: 'Young LA',
      category: null,
      country: 'us',
      status: 'hidden',
      curated: true,
    });
    expect(result).toMatchObject({ ok: true, flash: 'saved' });
    expect(
      await db.first(
        "SELECT name, country, status, category_slug FROM stores WHERE domain = 'youngla.com'",
      ),
    ).toEqual({
      name: 'Young LA',
      country: 'US',
      status: 'hidden',
      category_slug: null,
    });
    expect((await getOverviewCounts(db)).storesActive).toBe(before - 1);
    const [row] = await audit('store.update');
    expect(row?.target_id).toBe('youngla.com');
    expect(JSON.parse(row!.detail_json!)).toMatchObject({
      name: ['YoungLA', 'Young LA'],
      status: ['active', 'hidden'],
    });
    expect(
      await updateStore(ctx(), 'youngla.com', {
        name: 'Young LA',
        category: null,
        country: 'US',
        status: 'hidden',
        curated: true,
      }),
    ).toMatchObject({ flash: 'no_changes' });
  });

  it('validates store fields and never un-opts-out a store', async () => {
    expect(
      await updateStore(ctx(), 'youngla.com', {
        name: null,
        category: null,
        country: 'USA',
        status: null,
        curated: true,
      }),
    ).toMatchObject({ ok: false, flash: 'bad_country' });
    expect(
      await updateStore(ctx(), 'youngla.com', {
        name: null,
        category: 'nope',
        country: null,
        status: null,
        curated: true,
      }),
    ).toMatchObject({ ok: false, flash: 'bad_category' });
    expect(
      await updateStore(ctx(), 'missing.example', {
        name: null,
        category: null,
        country: null,
        status: null,
        curated: false,
      }),
    ).toMatchObject({ ok: false, flash: 'not_found' });
    await db.run("UPDATE stores SET status = 'opted_out' WHERE domain = 'youngla.com'");
    await updateStore(ctx(), 'youngla.com', {
      name: 'X',
      category: null,
      country: null,
      status: 'active',
      curated: true,
    });
    expect(await db.first("SELECT status FROM stores WHERE domain = 'youngla.com'")).toEqual({
      status: 'opted_out',
    });
  });

  it('queues a job once, refuses duplicates and unknown stores, and cancels queued jobs', async () => {
    expect(
      await queueJob(ctx(), { domain: 'https://www.YoungLA.com/', kind: 'rescan' }),
    ).toMatchObject({ ok: true, flash: 'queued_rescan' });
    expect(await queueJob(ctx(), { domain: 'youngla.com', kind: 'rescan' })).toMatchObject({
      ok: false,
      flash: 'already_queued',
    });
    expect(await queueJob(ctx(), { domain: 'youngla.com', kind: 'capture' })).toMatchObject({
      ok: true,
      flash: 'queued_capture',
    });
    expect(await queueJob(ctx(), { domain: 'never-seen.example', kind: 'rescan' })).toMatchObject({
      ok: false,
      flash: 'unknown_store',
    });
    expect(await queueJob(ctx(), { domain: 'never-seen.example', kind: 'detect' })).toMatchObject({
      ok: true,
    });
    expect(await queueJob(ctx(), { domain: 'not a domain', kind: 'detect' })).toMatchObject({
      ok: false,
      flash: 'bad_domain',
    });

    const job = await db.first<{ id: number; requested_by: string; status: string }>(
      "SELECT id, requested_by, status FROM scan_jobs WHERE domain = 'youngla.com' AND kind = 'rescan'",
    );
    expect(job).toMatchObject({ requested_by: 'admin', status: 'queued' });
    expect(await cancelJob(ctx(), job!.id)).toMatchObject({ ok: true, flash: 'cancelled' });
    expect(await cancelJob(ctx(), job!.id)).toMatchObject({ ok: false, flash: 'not_cancellable' });
    expect(await audit('job.cancel')).toHaveLength(1);
  });
});

describe('affiliates, teardowns, themes and apps', () => {
  it('edits and creates affiliate links (data, audited)', async () => {
    const link = await db.first<{ id: number; program_id: number | null }>(
      'SELECT id, program_id FROM affiliate_links ORDER BY id LIMIT 1',
    );
    const url = 'https://partners.example.com/r/abc123';
    expect(
      await updateLink(ctx(), link!.id, {
        url,
        label: 'Affiliate link',
        programId: link!.program_id,
        active: false,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await db.first('SELECT url, active FROM affiliate_links WHERE id = ?', [link!.id]),
    ).toEqual({ url, active: 0 });
    expect(
      await updateLink(ctx(), link!.id, { url, label: null, programId: 999_999, active: true }),
    ).toMatchObject({ ok: false, flash: 'bad_program' });

    const theme = await db.first<{ id: number; name: string }>(
      'SELECT id, name FROM themes LIMIT 1',
    );
    const created = await createLink(ctx(), {
      target: `theme:${theme!.id}`,
      url,
      label: 'Affiliate link',
      programId: null,
      active: true,
    });
    expect(created).toMatchObject({ ok: true, flash: 'link_created' });
    expect(
      await db.first('SELECT target_type, target_name FROM affiliate_links WHERE id = ?', [
        created.id!,
      ]),
    ).toEqual({ target_type: 'theme', target_name: theme!.name });
    expect(
      await createLink(ctx(), {
        target: 'app:999999',
        url,
        label: null,
        programId: null,
        active: true,
      }),
    ).toMatchObject({ ok: false, flash: 'bad_target' });
    expect(
      await createLink(ctx(), {
        target: "app:1' OR 1=1",
        url,
        label: null,
        programId: null,
        active: true,
      }),
    ).toMatchObject({ ok: false, flash: 'bad_target' });
    expect(await audit('affiliate_link.update')).toHaveLength(1);
    expect(await audit('affiliate_link.create')).toHaveLength(1);
  });

  it('publishes and unpublishes teardowns', async () => {
    const t = await db.first<{ id: number }>(
      'SELECT id FROM teardowns WHERE published_at IS NOT NULL LIMIT 1',
    );
    expect(await setTeardownPublished(ctx(), t!.id, false)).toMatchObject({
      ok: true,
      flash: 'unpublished',
    });
    expect(await db.first('SELECT published_at FROM teardowns WHERE id = ?', [t!.id])).toEqual({
      published_at: null,
    });
    expect(await setTeardownPublished(ctx(), t!.id, true)).toMatchObject({
      ok: true,
      flash: 'published',
    });
    expect(await db.first('SELECT published_at FROM teardowns WHERE id = ?', [t!.id])).toEqual({
      published_at: '2026-11-17',
    });
  });

  it('hides a theme and edits an app category', async () => {
    const theme = await db.first<{ id: number }>("SELECT id FROM themes WHERE slug = 'prestige'");
    expect(await updateTheme(ctx(), theme!.id, { status: 'hidden' })).toMatchObject({
      ok: true,
      flash: 'hidden',
    });
    expect(await updateTheme(ctx(), theme!.id, { priceLabel: '$450' })).toMatchObject({
      ok: true,
      flash: 'saved',
    });
    expect(
      await db.first('SELECT status, price_label FROM themes WHERE id = ?', [theme!.id]),
    ).toEqual({ status: 'hidden', price_label: '$450' });

    const app = await db.first<{ id: number }>('SELECT id FROM apps LIMIT 1');
    const cat = await db.first<{ id: number }>(
      'SELECT id FROM app_categories ORDER BY id DESC LIMIT 1',
    );
    expect(
      await updateApp(ctx(), app!.id, { categoryId: cat!.id, tagline: 'One line' }),
    ).toMatchObject({ ok: true });
    expect(await updateApp(ctx(), app!.id, { categoryId: 999_999 })).toMatchObject({
      ok: false,
      flash: 'bad_category',
    });
    expect(await updateApp(ctx(), app!.id, { name: '' })).toMatchObject({
      ok: false,
      flash: 'name_required',
    });
  });
});

describe('queries and flash', () => {
  it('filters stores with escaped LIKE patterns', async () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    const { rows, total } = await listStores(db, { q: 'youngla' });
    expect(total).toBe(1);
    expect(rows[0]?.domain).toBe('youngla.com');
    expect((await listStores(db, { q: '%' })).total).toBe(0);
    const curated = await listStores(db, { curated: true, captured: 'placeholder' });
    expect(curated.total).toBeGreaterThan(0);
    expect(curated.rows.every((r) => r.is_curated === 1 && r.placeholder_shots > 0)).toBe(true);
  });

  it('only renders known flash keys', () => {
    expect(readFlash(new URL('https://x.example/admin?ok=saved'))).toEqual({
      tone: 'positive',
      text: 'Changes saved.',
    });
    expect(readFlash(new URL('https://x.example/admin?err=<script>'))).toBeNull();
    expect(readFlash(new URL('https://x.example/admin?ok=removal_done&n=3'))?.text).toContain(
      'Deleted 3 stored images',
    );
    expect(flashHref('/admin/stores?q=a&ok=saved', { ok: false, flash: 'bad_url' })).toBe(
      '/admin/stores?q=a&err=bad_url',
    );
  });
});
