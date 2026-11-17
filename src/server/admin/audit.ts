/**
 * Audit log: one `admin_audit` row per mutating admin action, written in the same batch as the
 * change so the two cannot drift apart. Details hold what changed (before/after), never secrets.
 */
import type { Statement } from '../db/types.ts';

export interface AuditEntry {
  actor: string;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  detail?: Record<string, unknown> | null;
}

export function auditStatement(entry: AuditEntry, now: Date): Statement {
  return {
    sql: `INSERT INTO admin_audit (actor, action, target_type, target_id, detail_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    params: [
      entry.actor.slice(0, 200),
      entry.action,
      entry.targetType ?? null,
      entry.targetId === null || entry.targetId === undefined ? null : String(entry.targetId),
      entry.detail ? JSON.stringify(entry.detail) : null,
      now.toISOString(),
    ],
  };
}

/** Field-by-field diff for the audit detail: `{ name: ['Old', 'New'] }`. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && before[key] !== value) out[key] = [before[key] ?? null, value];
  }
  return out;
}

/** Human labels for audit actions (the overview and store pages render the log). */
export const AUDIT_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'store.update': 'Edited store',
  'store.queue_rescan': 'Queued rescan',
  'store.queue_capture': 'Queued capture',
  'job.queue': 'Queued job',
  'job.cancel': 'Cancelled job',
  'removal.approve': 'Approved removal',
  'removal.reject': 'Rejected removal',
  'removal.complete': 'Completed removal',
  'removal.media_deleted': 'Deleted media',
  'removal.media_failed': 'Media deletion failed',
  'removal.purge': 'Purged expired removal records',
  'affiliate_link.update': 'Edited affiliate link',
  'affiliate_link.create': 'Added affiliate link',
  'affiliate_program.update': 'Changed program status',
  'teardown.publish': 'Published teardown',
  'teardown.unpublish': 'Unpublished teardown',
  'theme.update': 'Edited theme',
  'app.update': 'Edited app',
};
