/// <reference types="node" />
/**
 * Test database: migrations + the generated seed applied to an in-memory node:sqlite database,
 * and API clients/handlers wired to it. The seed SQL is built once per test file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedFromRoot, type SeedResult } from '../../../scripts/seed/build.ts';
import { createApiClient } from '../../../src/server/api/v1/client.ts';
import type { ApiDeps } from '../../../src/server/api/v1/execute.ts';
import { createApiHandler } from '../../../src/server/api/v1/router.ts';
import { openNodeDb, type NodeDb } from '../../../src/server/db/node-sqlite.ts';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let seed: SeedResult | null = null;
export const seedResult = (): SeedResult => (seed ??= buildSeedFromRoot(ROOT));

export function migrationsSql(): string {
  const dir = join(ROOT, 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/** A fresh, fully seeded in-memory database. */
export function seededDb(): NodeDb {
  const db = openNodeDb();
  db.raw.exec(migrationsSql());
  db.raw.exec('BEGIN');
  db.raw.exec(seedResult().sql);
  db.raw.exec('COMMIT');
  return db;
}

export const FIXED_NOW = new Date('2026-11-17T12:00:00.000Z');

export function testDeps(db: NodeDb, overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    db,
    env: { IP_HASH_SALT: 'test-salt' },
    now: () => FIXED_NOW,
    validateOutput: true,
    ...overrides,
  };
}

export function setup(overrides: Partial<ApiDeps> = {}) {
  const db = seededDb();
  const deps = testDeps(db, overrides);
  return { db, api: createApiClient(deps), http: createApiHandler(deps) };
}

/** GET helper for the HTTP handler. */
export const get = (http: (r: Request) => Promise<Response>, path: string, init?: RequestInit) =>
  http(new Request(`https://test.local${path}`, init));
