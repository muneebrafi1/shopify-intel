/**
 * Worker-only entry point for the admin: bindings and variables from `cloudflare:workers`.
 * Everything else in src/server/admin and src/server/auth takes `Db` / `AdminEnv` as arguments so
 * it can be unit-tested on node:sqlite.
 */
import { env } from 'cloudflare:workers';
import { d1Db } from '../db/d1.ts';
import type { Db } from '../db/types.ts';
import { apiTokenFrom } from '../auth/api-token.ts';
import { readAuthConfig, type AdminEnv, type AuthConfig } from '../auth/config.ts';

export const adminEnv = (): AdminEnv => env as unknown as AdminEnv;

export function adminDb(): Db {
  return d1Db(adminEnv().DB);
}

export function adminAuthConfig(): AuthConfig {
  return readAuthConfig(adminEnv());
}

/** ADMIN_API_TOKEN when token sign-in is enabled (set and long enough), else null. */
export function adminApiToken(): string | null {
  return apiTokenFrom(adminEnv());
}
