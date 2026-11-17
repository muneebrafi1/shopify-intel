import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approveRemoval } from '../../src/server/admin/actions.ts';
import { captureBlockFor, isCaptureBlocked } from '../../src/server/repo/capture.ts';
import {
  REMOVAL_RECORD_RETENTION_DAYS,
  purgeExpiredRemovalRecords,
} from '../../src/server/repo/removal.ts';
import type { NodeDb } from '../../src/server/db/node-sqlite.ts';
import { FIXED_NOW, seededDb } from './helpers/db.ts';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(FIXED_NOW.getTime() - n * DAY).toISOString();

let db: NodeDb;
beforeEach(() => {
  db = seededDb();
});
afterEach(() => db.close());

async function addRequest(
  ref: string,
  status: 'pending' | 'approved' | 'rejected' | 'done',
  handledDaysAgo: number | null,
  createdDaysAgo = (handledDaysAgo ?? 0) + 2,
  scope: 'store' | 'screenshots' | 'details' = 'details',
) {
  const res = await db.run(
    `INSERT INTO removal_requests (reference, domain, email, reason, scope, status, ip_hash, created_at, handled_at)
     VALUES (?, ?, 'owner@example.com', 'Please remove our store from the site.', ?, ?, 'abc', ?, ?)`,
    [
      ref,
      `${ref.toLowerCase()}.example`,
      scope,
      status,
      daysAgo(createdDaysAgo),
      handledDaysAgo === null ? null : daysAgo(handledDaysAgo),
    ],
  );
  return res.lastRowId!;
}

const refs = async () =>
  (
    await db.all<{ reference: string }>('SELECT reference FROM removal_requests ORDER BY reference')
  ).map((r) => r.reference);

describe('removal record retention', () => {
  it('keeps records for two years', () => {
    expect(REMOVAL_RECORD_RETENTION_DAYS).toBe(730);
  });

  it('purges only closed requests decided more than two years ago', async () => {
    await addRequest('RR-OLDDONE', 'done', 731);
    await addRequest('RR-OLDREJ', 'rejected', 800);
    await addRequest('RR-EDGE', 'done', 729); // inside the window
    await addRequest('RR-NEWDONE', 'done', 10);
    await addRequest('RR-OLDPEND', 'pending', null, 900); // never handled: kept
    await addRequest('RR-OLDAPPR', 'approved', 900); // media deletion outstanding: kept

    const dry = await purgeExpiredRemovalRecords(db, FIXED_NOW, { dryRun: true });
    expect(dry).toEqual({
      purged: 2,
      cutoff: daysAgo(730),
      retention_days: 730,
      dry_run: true,
    });
    expect(await refs()).toHaveLength(6);

    const res = await purgeExpiredRemovalRecords(db, FIXED_NOW, { actor: 'api-token' });
    expect(res).toMatchObject({ purged: 2, dry_run: false });
    expect(await refs()).toEqual(['RR-EDGE', 'RR-NEWDONE', 'RR-OLDAPPR', 'RR-OLDPEND']);
    const audit = await db.all<{ actor: string; detail_json: string }>(
      "SELECT actor, detail_json FROM admin_audit WHERE action = 'removal.purge'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe('api-token');
    expect(JSON.parse(audit[0]?.detail_json ?? '{}')).toMatchObject({ purged: 2 });
    expect(audit[0]?.detail_json).not.toContain('owner@example.com');

    // Idempotent: nothing left to purge, and no audit noise.
    expect((await purgeExpiredRemovalRecords(db, FIXED_NOW)).purged).toBe(0);
    expect(
      await db.first("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'removal.purge'"),
    ).toEqual({ n: 1 });
  });

  it('keeps the capture block and tombstone after the request record is purged', async () => {
    const store = await db.first<{ domain: string }>(
      'SELECT domain FROM stores WHERE is_curated = 1 LIMIT 1',
    );
    const domain = store?.domain ?? '';
    const handledAt = new Date(FIXED_NOW.getTime() - 800 * DAY);
    const id = (
      await db.run(
        `INSERT INTO removal_requests (reference, domain, email, reason, scope, status, created_at)
         VALUES ('RR-BLOCKED1', ?, 'owner@example.com', 'Please stop capturing our store.', 'screenshots', 'pending', ?)`,
        [domain, daysAgo(801)],
      )
    ).lastRowId!;
    // Approved 800 days ago (no R2 objects, so it goes straight to 'done').
    await approveRemoval({ db, actor: 'admin', now: handledAt, media: null }, id, {
      note: null,
      confirmed: true,
    });
    const tomb = await addRequest('RR-TOMB', 'pending', null, 801, 'store');
    await approveRemoval({ db, actor: 'admin', now: handledAt, media: null }, tomb, {
      note: null,
      confirmed: true,
    });
    expect(await db.first('SELECT status FROM removal_requests WHERE id = ?', [id])).toEqual({
      status: 'done',
    });

    expect((await purgeExpiredRemovalRecords(db, FIXED_NOW)).purged).toBe(2);
    expect(await db.first('SELECT id FROM removal_requests WHERE id = ?', [id])).toBeNull();
    expect(await isCaptureBlocked(db, domain)).toBe(true);
    expect(await captureBlockFor(db, domain)).toMatchObject({
      scope: 'screenshots',
      reference: 'RR-BLOCKED1',
      removal_request_id: null,
    });
    expect(
      await db.first('SELECT removal_request_id FROM store_tombstones WHERE domain = ?', [
        'rr-tomb.example',
      ]),
    ).toEqual({ removal_request_id: null });
    expect(await isCaptureBlocked(db, 'rr-tomb.example')).toBe(true);
  });
});
