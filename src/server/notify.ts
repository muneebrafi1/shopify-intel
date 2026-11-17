/**
 * Admin notifications. Owner decision (draft): the admin is told about every new removal request.
 *
 * A notifier has a pluggable transport. None is configured yet, so it fails safe: it sends
 * nothing and logs one structured line with no personal data (no requester email, name, reason or
 * domain), for example
 *
 *   removal_request.created id=123 scope=screenshots notify=skipped reason=no_transport
 *
 * Notifying never throws and never blocks or fails the request that triggered it: callers run it
 * through `runInBackground()` (ctx.waitUntil on Workers, otherwise awaited with a catch).
 *
 * Plugging a provider later: implement `NotifyTransport` (e.g. `fetch` to a mail API with its key
 * stored as a Wrangler secret, read from `env`) and pass it to `createNotifier()` in
 * `workerDeps()` (src/server/api/index.ts). The recipient is ADMIN_NOTIFY_EMAIL (name documented
 * in .env.example; the value is a secret/var, never in code). See docs/ARCHITECTURE.md.
 */
import { SITE_NAME, SITE_URL } from '../config/site.ts';

export interface NotifyMessage {
  to: string;
  subject: string;
  /** Plain text. Holds no requester personal data; the admin page has the details. */
  text: string;
}

export interface NotifyTransport {
  /** Short provider name for the log line, e.g. 'mail-api'. */
  readonly name: string;
  send(message: NotifyMessage): Promise<void>;
}

export interface RemovalRequestEvent {
  /** Database id of the stored request (the admin page is /admin/removals/<id>). */
  id: number | null;
  reference: string;
  scope: 'store' | 'screenshots' | 'details';
  domain: string;
}

export type NotifyOutcome = 'sent' | 'skipped' | 'failed';

export interface Notifier {
  removalRequestCreated(event: RemovalRequestEvent): Promise<NotifyOutcome>;
}

export interface NotifierOptions {
  /** ADMIN_NOTIFY_EMAIL. Unset or invalid → nothing is sent. */
  to?: string | null | undefined;
  transport?: NotifyTransport | null;
  /** Where the structured line goes. Defaults to console.info. */
  log?: (line: string) => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Log values are ids, enums and provider names; anything else is replaced, never echoed. */
const safe = (v: string | number | null) =>
  v === null ? 'null' : /^[A-Za-z0-9_.-]{1,40}$/.test(String(v)) ? String(v) : 'invalid';

export function createNotifier(opts: NotifierOptions = {}): Notifier {
  const log = opts.log ?? ((line: string) => console.info(line));
  const to = opts.to?.trim() ?? '';
  const transport = opts.transport ?? null;

  return {
    async removalRequestCreated(event) {
      const head = `removal_request.created id=${safe(event.id)} scope=${safe(event.scope)}`;
      let outcome: NotifyOutcome = 'skipped';
      let tail = '';
      if (!transport) tail = 'reason=no_transport';
      else if (!to) tail = 'reason=no_recipient';
      else if (!EMAIL.test(to)) tail = 'reason=bad_recipient';
      else {
        try {
          await transport.send({
            to,
            subject: `[${SITE_NAME}] New removal request ${event.reference} (${event.scope})`,
            text: [
              `A removal request was submitted: ${event.reference}`,
              `Store: ${event.domain}`,
              `Scope: ${event.scope}`,
              event.id !== null ? `Review it: ${SITE_URL}/admin/removals/${event.id}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          });
          outcome = 'sent';
          tail = `transport=${safe(transport.name)}`;
        } catch {
          // The provider's error may echo the message; it is not logged.
          outcome = 'failed';
          tail = `transport=${safe(transport.name)}`;
        }
      }
      try {
        log(`${head} notify=${outcome}${tail ? ` ${tail}` : ''}`);
      } catch {
        // Logging must not break anything either.
      }
      return outcome;
    },
  };
}

/** Schedules work after the response (Workers waitUntil); without it, waits and swallows errors. */
export type WaitUntil = (promise: Promise<unknown>) => void;

export async function runInBackground(
  waitUntil: WaitUntil | null | undefined,
  work: () => Promise<unknown>,
): Promise<void> {
  const guarded = async () => {
    try {
      await work();
    } catch (err) {
      console.error('[notify] background task failed', err instanceof Error ? err.name : 'error');
    }
  };
  const task = guarded();
  if (waitUntil) {
    try {
      waitUntil(task);
      return;
    } catch {
      // No request context (e.g. called outside a fetch handler): wait for it instead.
    }
  }
  await task;
}
