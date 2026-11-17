/**
 * Worker-bound entry points for the API: the in-process client pages use, and the HTTP handler
 * behind src/pages/api/v1/[...path].ts. Bindings come from `cloudflare:workers` (Astro ≥ 6).
 *
 *   import { api } from '~/server/api';
 *   const { data: store } = await api.getStore({ domain: 'thesill.com' });
 *
 * Tests and scripts build their own client with `createApiClient({ db })` (node:sqlite adapter).
 */
import { env, waitUntil as cfWaitUntil } from 'cloudflare:workers';
import { d1Db } from '../db/d1.ts';
import { createNotifier } from '../notify.ts';
import { createApiClient, type ApiClient } from './v1/client.ts';
import type { ApiDeps } from './v1/execute.ts';
import { createApiHandler, type RouterOptions } from './v1/router.ts';

export function workerDeps(): ApiDeps {
  return {
    db: d1Db(env.DB),
    env: {
      IP_HASH_SALT: env.IP_HASH_SALT,
      MEDIA_BASE_URL: env.MEDIA_BASE_URL,
      ADMIN_NOTIFY_EMAIL: env.ADMIN_NOTIFY_EMAIL,
    },
    // No mail transport yet (owner: placeholder): new removal requests are logged without
    // personal data. Plug a provider here; see src/server/notify.ts.
    notifier: createNotifier({ to: env.ADMIN_NOTIFY_EMAIL, transport: null }),
    waitUntil: (promise) => cfWaitUntil(promise),
    mediaStore: env.MEDIA ?? null,
    // Schema-check responses in dev so shape drift is caught before production.
    validateOutput: import.meta.env.DEV,
  };
}

/** The in-process client for Astro pages and endpoints. */
export const api: ApiClient = createApiClient(workerDeps);

let handler: ((request: Request) => Promise<Response>) | null = null;

/** HTTP handler for /api/v1/*. Pass mounts (e.g. the admin namespace) on first use. */
export function apiHandler(opts?: RouterOptions): (request: Request) => Promise<Response> {
  handler ??= createApiHandler(workerDeps(), opts);
  return handler;
}

export { ApiError, isApiError, orNotFound } from './v1/errors.ts';
export type { ApiClient } from './v1/client.ts';
export type * from './v1/types.ts';
