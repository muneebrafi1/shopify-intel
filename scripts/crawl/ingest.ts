/// <reference types="node" />
/**
 * npm run crawl:ingest [-- --base http://127.0.0.1:4321]
 *
 * Posts .data/crawl/scans.json to the admin API (`POST /api/v1/admin/scans`, one scan per
 * request, derived counts rebuilt after the last) of a LOCAL server (`astro dev`). Authenticates
 * with ADMIN_API_TOKEN from .dev.vars (a throwaway local token; see docs/CRAWL.md). Refuses
 * non-local bases: production ingest needs the owner's go-ahead.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from '../capture/paths.ts';
import { SCANS_FILE } from './paths.ts';

const { values } = parseArgs({
  options: { base: { type: 'string', default: 'http://127.0.0.1:4321' } },
});
const base = new URL(values.base);
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  console.error('crawl:ingest only talks to a local server.');
  process.exit(1);
}
const vars = existsSync(join(ROOT, '.dev.vars'))
  ? readFileSync(join(ROOT, '.dev.vars'), 'utf8')
  : '';
const token = /^ADMIN_API_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim().replace(/^"|"$/g, '');
if (!token) {
  console.error('Set ADMIN_API_TOKEN (32+ chars) in .dev.vars and restart astro dev.');
  process.exit(1);
}
const all = JSON.parse(readFileSync(SCANS_FILE, 'utf8')) as Array<{ scan: unknown; note?: string }>;
const counts: Record<string, number> = {};
for (const [i, item] of all.entries()) {
  const res = await fetch(new URL('/api/v1/admin/scans', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ scans: [item.scan], rebuild: i === all.length - 1 }),
  });
  const body = (await res.json()) as {
    data?: {
      results: Array<{ domain: string; status: string; theme?: string; apps_added?: number }>;
    };
    error?: { message: string };
  };
  if (!res.ok || !body.data) {
    console.log(
      `  FAIL ${(item.scan as { domain: string }).domain}: ${res.status} ${body.error?.message ?? ''}`,
    );
    counts.failed = (counts.failed ?? 0) + 1;
    continue;
  }
  for (const r of body.data.results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(
      `  ${r.status.padEnd(13)} ${r.domain}${r.theme ? ` theme ${r.theme}` : ''}${r.apps_added ? `, +${r.apps_added} apps` : ''}`,
    );
  }
}
console.log(`Done: ${JSON.stringify(counts)}`);
