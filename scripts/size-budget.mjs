#!/usr/bin/env node
/**
 * Size budgets for the built Worker (run after `npm run build`).
 *  - Client JS and CSS stay small: the site is server-rendered and image-first.
 *  - The server bundle must fit the Workers free plan (3 MB gzipped); we keep headroom.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGETS = { clientJs: 60 * 1024, clientCss: 45 * 1024, server: 2.5 * 1024 * 1024 };
const root = new URL('../dist', import.meta.url).pathname;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const gz = (files) => files.reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);

const client = walk(join(root, 'client'));
const server = walk(join(root, 'server')).filter((f) => ['.mjs', '.js'].includes(extname(f)));
const totals = {
  clientJs: gz(client.filter((f) => f.endsWith('.js'))),
  clientCss: gz(client.filter((f) => f.endsWith('.css'))),
  server: gz(server),
};
let failed = false;
for (const [key, size] of Object.entries(totals)) {
  const ok = size <= BUDGETS[key];
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key.padEnd(10)} ${(size / 1024).toFixed(1).padStart(8)} KB gz  (budget ${(BUDGETS[key] / 1024).toFixed(0)} KB)`);
}
process.exit(failed ? 1 : 0);
