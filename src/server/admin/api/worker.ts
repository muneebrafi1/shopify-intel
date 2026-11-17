/**
 * Worker entry for the admin API: the router with only the admin mount, wired to the Worker's
 * bindings. Used by src/pages/api/v1/admin/[...path].ts.
 */
import { workerDeps } from '../../api/index.ts';
import { createApiHandler } from '../../api/v1/router.ts';
import { adminApiToken, adminAuthConfig } from '../env.ts';
import { createAdminMount } from './mount.ts';

let handler: ((request: Request) => Promise<Response>) | null = null;

export function adminApiHandler(): (request: Request) => Promise<Response> {
  handler ??= createApiHandler(workerDeps(), {
    publicRoutes: false,
    mounts: [createAdminMount({ authConfig: adminAuthConfig, apiToken: adminApiToken })],
  });
  return handler;
}
