/// <reference types="node" />
/**
 * npm run db:reset
 * Recreates the LOCAL D1 database (never remote): deletes .wrangler/state/v3/d1, applies
 * migrations/ and loads .data/seed.sql (run `npm run db:build-seed` first, or `npm run setup`).
 * Restart any running dev server afterwards: it keeps the old database file open.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = join(root, '.data/seed.sql');
if (!existsSync(seed)) {
  console.error('Missing .data/seed.sql. Run `npm run db:build-seed` first.');
  process.exit(1);
}

// Wrangler telemetry off; stdin ignored so `migrations apply` runs without a prompt.
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
/** Runs wrangler; with `quiet`, stdout (one JSON result per statement) is summarised. */
const wrangler = (args: string[], quiet = false) => {
  console.log(`> wrangler ${args.join(' ')}`);
  const res = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    env,
    stdio: ['ignore', quiet ? 'pipe' : 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    if (quiet) console.log(res.stdout);
    process.exit(res.status ?? 1);
  }
  if (quiet) {
    const statements = (res.stdout.match(/"success": true/g) ?? []).length;
    console.log(statements ? `  ${statements} statements executed` : res.stdout.trim());
  }
};

rmSync(join(root, '.wrangler/state/v3/d1'), { recursive: true, force: true });
wrangler(['d1', 'migrations', 'apply', 'DB', '--local']);
wrangler(['d1', 'execute', 'DB', '--local', `--file=${seed}`], true);
console.log('Local D1 ready. Restart the dev server if one is running.');
