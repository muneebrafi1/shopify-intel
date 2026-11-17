/**
 * Flash messages after a form post. The redirect carries only a known key (`?ok=saved` or
 * `?err=not_found`, plus an optional number), never free text, so the URL cannot be used to
 * put arbitrary words on an admin page.
 */
import type { ActionResult } from './actions.ts';

const MESSAGES: Record<string, string> = {
  // Success
  saved: 'Changes saved.',
  saved_rebuild_failed:
    'Saved, but rebuilding public counts failed. It will catch up on the next ingest.',
  no_changes: 'Nothing changed.',
  queued_rescan: 'Rescan queued. The crawler picks it up on its next run.',
  queued_capture: 'Capture queued. The crawler picks it up on its next run.',
  cancelled: 'Job cancelled.',
  removal_done: 'Removal approved and completed.',
  removal_details_done:
    'Marked as done. Edit the store details by hand if anything needs changing.',
  removal_rejected: 'Request rejected.',
  link_created: 'Affiliate link added.',
  published: 'Teardown published.',
  unpublished: 'Teardown unpublished. Its public page now returns 404.',
  hidden: 'Hidden from the public site.',
  unhidden: 'Visible on the public site again.',
  signed_out: 'You are signed out.',
  // Errors
  not_found: 'That record no longer exists.',
  bad_request: 'The form could not be read. Reload the page and try again.',
  too_long: 'One of the fields is too long.',
  bad_url: 'Enter a full https:// URL.',
  bad_domain: 'Enter a valid store domain, like example.com.',
  bad_country: 'Country must be a two-letter code, like US or GB.',
  bad_category: 'Pick a category from the list.',
  bad_program: 'Pick a program from the list.',
  bad_target: 'Pick an app, theme or vendor from the list.',
  name_required: 'Name cannot be empty.',
  unknown_store: 'That store is not in the database. Use a detect job for new domains.',
  opted_out: 'That store opted out. It cannot be scanned or captured again.',
  already_queued: 'A job of that kind is already queued or running for this store.',
  not_cancellable: 'Only queued jobs can be cancelled.',
  confirm_required: 'Tick the confirmation box to approve.',
  note_required: 'Add a short note explaining the rejection.',
  already_handled: 'This request was already handled.',
  media_unavailable:
    'The store is hidden, but its images could not be deleted: the MEDIA storage binding is missing. Retry once it is configured.',
  media_failed: 'The store is hidden, but deleting its images failed. Retry from the request page.',
  store_not_active: 'The store is hidden or opted out, so its teardown cannot be published.',
  capture_blocked:
    'Captures of this store are blocked by an approved removal request. Detection rescans still work.',
};

/** The message for a flash key, or null for an unknown key (also used by the admin API). */
export const flashText = (key: string): string | null => MESSAGES[key] ?? null;

export interface Flash {
  tone: 'positive' | 'critical' | 'info';
  text: string;
}

export function readFlash(url: URL): Flash | null {
  const okKey = url.searchParams.get('ok');
  const errKey = url.searchParams.get('err');
  const n = Number(url.searchParams.get('n'));
  const key = errKey ?? okKey;
  if (!key) return null;
  let text = MESSAGES[key];
  if (!text) return null;
  if (key === 'removal_done' && Number.isFinite(n)) {
    text =
      n > 0
        ? `Removal approved. Deleted ${n.toLocaleString('en-US')} stored ${n === 1 ? 'image' : 'images'}.`
        : 'Removal approved. There were no stored images to delete (layout previews only).';
  }
  return { tone: errKey ? 'critical' : key === 'no_changes' ? 'info' : 'positive', text };
}

/** Path + query for the redirect after an action, replacing any previous flash params. */
export function flashHref(
  pathWithQuery: string,
  result: Pick<ActionResult, 'ok' | 'flash' | 'n'>,
): string {
  const url = new URL(pathWithQuery, 'http://x');
  url.searchParams.delete('ok');
  url.searchParams.delete('err');
  url.searchParams.delete('n');
  url.searchParams.set(result.ok ? 'ok' : 'err', result.flash);
  if (typeof result.n === 'number') url.searchParams.set('n', String(result.n));
  return `${url.pathname}${url.search}`;
}
