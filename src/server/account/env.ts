/**
 * Worker-only entry point for accounts: bindings and variables from `cloudflare:workers`.
 * Everything else in src/server/account and src/server/whop takes `Db` / config as arguments.
 */
import { env } from 'cloudflare:workers';
import { d1Db } from '../db/d1.ts';
import type { Db } from '../db/types.ts';
import { readWhopConfig, type WhopConfig, type WhopEnv } from '../whop/config.ts';

export const accountDb = (): Db => d1Db((env as unknown as { DB: D1Database }).DB);
export const whopConfig = (): WhopConfig => readWhopConfig(env as unknown as WhopEnv);

let runtime: import('../api/v1/execute.ts').Runtime | null = null;
/** A read context (media URLs, data info) for the repo helpers the board views reuse. */
export async function accountCtx() {
  const [{ workerDeps }, { buildCtx, createRuntime }] = await Promise.all([
    import('../api/index.ts'),
    import('../api/v1/execute.ts'),
  ]);
  runtime ??= createRuntime(workerDeps());
  return buildCtx(runtime, null);
}
