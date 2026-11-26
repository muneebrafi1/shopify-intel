#!/usr/bin/env node
/**
 * Launch preflight & read-only post-deploy smoke checks.
 *
 * Usage:
 *   node scripts/ops/preflight.ts            # offline config & migration check
 *   node scripts/ops/preflight.ts --strict   # fails if placeholder IDs/domain/notice are still set
 *   node scripts/ops/preflight.ts --smoke http://127.0.0.1:4400
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface PreflightItem {
  id: string;
  status: CheckStatus;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightItem[];
}

const PLACEHOLDER_DB_ID = '00000000-0000-0000-0000-000000000000';
const REQUIRED_ENV_NAMES = [
  'IP_HASH_SALT',
  'ADMIN_SESSION_SECRET',
  'CF_ACCESS_TEAM_DOMAIN',
  'CF_ACCESS_AUD',
  'USER_SESSION_SECRET',
  'WHOP_CLIENT_ID',
  'WHOP_WEBHOOK_SECRET',
  'WHOP_PRO_PRODUCT_ID',
  'WHOP_TEAM_PRODUCT_ID',
] as const;

/** Strip // and /* *\/ comments + trailing commas from JSONC without touching string literals. */
export function parseJsonc(raw: string): unknown {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  const noTrailingCommas = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

function parseEnvKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/^#\s*/, '');
    const m = /^([A-Z][A-Z0-9_]+)=/.exec(line);
    if (m?.[1]) keys.add(m[1]);
  }
  return keys;
}

export function auditConfig(rootDir: string, options: { strict?: boolean } = {}): PreflightResult {
  const strict = options.strict ?? false;
  const checks: PreflightItem[] = [];
  const pendingStatus: CheckStatus = strict ? 'fail' : 'warn';

  // 1. wrangler.jsonc
  const wranglerPath = join(rootDir, 'wrangler.jsonc');
  if (!existsSync(wranglerPath)) {
    checks.push({ id: 'wrangler', status: 'fail', message: 'Missing wrangler.jsonc' });
  } else {
    try {
      const cfg = parseJsonc(readFileSync(wranglerPath, 'utf8')) as {
        name?: string;
        compatibility_date?: string;
        d1_databases?: Array<{ binding?: string; database_id?: string; migrations_dir?: string }>;
        r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
      };
      const db = cfg.d1_databases?.find((d) => d.binding === 'DB');
      const r2 = cfg.r2_buckets?.find((b) => b.binding === 'MEDIA');
      if (!cfg.name || !cfg.compatibility_date) {
        checks.push({
          id: 'wrangler',
          status: 'fail',
          message: 'wrangler.jsonc missing name or compatibility_date',
        });
      } else if (!db || db.migrations_dir !== 'migrations') {
        checks.push({
          id: 'wrangler-d1',
          status: 'fail',
          message: 'wrangler.jsonc missing DB binding with migrations_dir="migrations"',
        });
      } else if (db.database_id === PLACEHOLDER_DB_ID || !db.database_id) {
        checks.push({
          id: 'wrangler-d1-id',
          status: pendingStatus,
          message: 'wrangler.jsonc still uses placeholder database_id (replace after d1 create)',
        });
      } else {
        checks.push({
          id: 'wrangler-d1-id',
          status: 'ok',
          message: `wrangler.jsonc D1 binding DB configured (${db.database_id})`,
        });
      }
      if (!r2?.bucket_name) {
        checks.push({
          id: 'wrangler-r2',
          status: 'fail',
          message: 'wrangler.jsonc missing MEDIA R2 bucket binding',
        });
      } else {
        checks.push({
          id: 'wrangler-r2',
          status: 'ok',
          message: `wrangler.jsonc R2 binding MEDIA configured (${r2.bucket_name})`,
        });
      }
    } catch (err) {
      checks.push({
        id: 'wrangler',
        status: 'fail',
        message: `Failed to parse wrangler.jsonc: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 2. Sequential SQL migrations
  const migDir = join(rootDir, 'migrations');
  if (!existsSync(migDir)) {
    checks.push({ id: 'migrations', status: 'fail', message: 'Missing migrations/ directory' });
  } else {
    const sqlFiles = readdirSync(migDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const nums = sqlFiles
      .map((f) => Number(/^(\d{4})_/.exec(f)?.[1] ?? NaN))
      .filter((n) => !Number.isNaN(n));
    const sequential =
      sqlFiles.length >= 5 &&
      nums.length === sqlFiles.length &&
      nums.every((n, i) => n === i + 1) &&
      sqlFiles.every((f) => statSync(join(migDir, f)).size > 0);
    checks.push(
      sequential
        ? {
            id: 'migrations',
            status: 'ok',
            message: `${sqlFiles.length} sequential non-empty migrations (0001..${String(sqlFiles.length).padStart(4, '0')})`,
          }
        : {
            id: 'migrations',
            status: 'fail',
            message: `Invalid migration sequence in migrations/: ${sqlFiles.join(', ')}`,
          },
    );
  }

  // 3. Site config launch flags
  const sitePath = join(rootDir, 'src/config/site.ts');
  if (!existsSync(sitePath)) {
    checks.push({ id: 'site-config', status: 'fail', message: 'Missing src/config/site.ts' });
  } else {
    const siteSrc = readFileSync(sitePath, 'utf8');
    const domain = /SITE_DOMAIN = '([^']+)'/.exec(siteSrc)?.[1] ?? '';
    const notice = /SHOW_CAPTURE_PREVIEW_NOTICE = (true|false)/.exec(siteSrc)?.[1];
    if (!domain || domain.endsWith('.example')) {
      checks.push({
        id: 'site-domain',
        status: pendingStatus,
        message: `SITE_DOMAIN is still "${domain || 'unset'}" (update before custom-domain launch)`,
      });
    } else {
      checks.push({ id: 'site-domain', status: 'ok', message: `SITE_DOMAIN="${domain}"` });
    }
    if (notice !== 'false') {
      checks.push({
        id: 'capture-notice',
        status: pendingStatus,
        message:
          'SHOW_CAPTURE_PREVIEW_NOTICE is true (set false once R2 captures are ingested live)',
      });
    } else {
      checks.push({
        id: 'capture-notice',
        status: 'ok',
        message: 'SHOW_CAPTURE_PREVIEW_NOTICE is false',
      });
    }
  }

  // 4. Static SEO / brand assets
  for (const rel of ['public/og-default.png', 'public/favicon.svg', 'public/_headers']) {
    const p = join(rootDir, rel);
    const ok = existsSync(p) && statSync(p).size > 0;
    checks.push({
      id: `asset:${rel}`,
      status: ok ? 'ok' : 'fail',
      message: ok ? `${rel} present` : `Missing or empty ${rel}`,
    });
  }

  // 5. Env var documentation parity (.env.example + .dev.vars.example)
  for (const envFile of ['.env.example', '.dev.vars.example']) {
    const p = join(rootDir, envFile);
    if (!existsSync(p)) {
      checks.push({ id: `env:${envFile}`, status: 'fail', message: `Missing ${envFile}` });
      continue;
    }
    const keys = parseEnvKeys(readFileSync(p, 'utf8'));
    const missing = REQUIRED_ENV_NAMES.filter((k) => !keys.has(k));
    checks.push(
      missing.length === 0
        ? { id: `env:${envFile}`, status: 'ok', message: `${envFile} documents all launch vars` }
        : {
            id: `env:${envFile}`,
            status: 'fail',
            message: `${envFile} missing documented vars: ${missing.join(', ')}`,
          },
    );
  }

  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}

export async function runSmokeChecks(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PreflightResult> {
  const origin = baseUrl.replace(/\/+$/, '');
  const checks: PreflightItem[] = [];

  const get = async (path: string, redirect: RequestRedirect = 'follow') =>
    fetchImpl(`${origin}${path}`, { redirect });

  // 1. Home HTML + canonical + OG + security headers
  try {
    const res = await get('/');
    const html = await res.text();
    const ok =
      res.status === 200 &&
      html.includes('rel="canonical"') &&
      html.includes('property="og:image"') &&
      res.headers.get('x-content-type-options') === 'nosniff';
    checks.push({
      id: 'smoke:home',
      status: ok ? 'ok' : 'fail',
      message: ok
        ? 'GET / → 200 with canonical, og:image, nosniff'
        : `GET / failed (status=${res.status}, nosniff=${res.headers.get('x-content-type-options')})`,
    });
  } catch (err) {
    checks.push({ id: 'smoke:home', status: 'fail', message: `GET / error: ${String(err)}` });
  }

  // 2. robots.txt & XML sitemaps & og-default.png
  for (const [id, path, contentMatch, bodyMatch] of [
    ['smoke:robots', '/robots.txt', 'text/plain', 'Sitemap:'],
    ['smoke:sitemap-index', '/sitemap.xml', 'xml', '<sitemapindex'],
    ['smoke:sitemap-core', '/sitemaps/core.xml', 'xml', '<urlset'],
    ['smoke:sitemap-sections', '/sitemaps/sections.xml', 'xml', '<urlset'],
  ] as const) {
    try {
      const res = await get(path);
      const body = await res.text();
      const ct = res.headers.get('content-type') ?? '';
      const ok = res.status === 200 && ct.includes(contentMatch) && body.includes(bodyMatch);
      checks.push({
        id,
        status: ok ? 'ok' : 'fail',
        message: ok
          ? `GET ${path} → 200 (${ct})`
          : `GET ${path} failed (status=${res.status}, ct=${ct})`,
      });
    } catch (err) {
      checks.push({ id, status: 'fail', message: `GET ${path} error: ${String(err)}` });
    }
  }

  try {
    const res = await get('/og-default.png');
    await res.arrayBuffer();
    const ct = res.headers.get('content-type') ?? '';
    const ok = res.status === 200 && ct.includes('image/png');
    checks.push({
      id: 'smoke:og-png',
      status: ok ? 'ok' : 'fail',
      message: ok ? 'GET /og-default.png → 200 (image/png)' : `GET /og-default.png → ${res.status}`,
    });
  } catch (err) {
    checks.push({
      id: 'smoke:og-png',
      status: 'fail',
      message: `GET /og-default.png error: ${String(err)}`,
    });
  }

  // 3. API v1 meta
  try {
    const res = await get('/api/v1/meta');
    const json = (await res.json()) as { data?: { counts?: { stores_curated?: number } } };
    const curated = json.data?.counts?.stores_curated ?? 0;
    const ok = res.status === 200 && curated > 0;
    checks.push({
      id: 'smoke:api-meta',
      status: ok ? 'ok' : 'fail',
      message: ok
        ? `GET /api/v1/meta → 200 (${curated} curated stores)`
        : `GET /api/v1/meta failed (status=${res.status}, curated=${curated})`,
    });
  } catch (err) {
    checks.push({
      id: 'smoke:api-meta',
      status: 'fail',
      message: `GET /api/v1/meta error: ${String(err)}`,
    });
  }

  // 4. Read-only MCP tools/list
  try {
    const res = await fetchImpl(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const json = (await res.json()) as { result?: { tools?: unknown[] } };
    const count = json.result?.tools?.length ?? 0;
    const ok = res.status === 200 && count === 22;
    checks.push({
      id: 'smoke:mcp',
      status: ok ? 'ok' : 'fail',
      message: ok
        ? `POST /mcp tools/list → 200 (${count} tools)`
        : `POST /mcp failed (status=${res.status}, tools=${count})`,
    });
  } catch (err) {
    checks.push({ id: 'smoke:mcp', status: 'fail', message: `POST /mcp error: ${String(err)}` });
  }

  // 5. Pro & Teardowns
  try {
    const pro = await get('/pro');
    const proHtml = await pro.text();
    const ok = pro.status === 200 && proHtml.includes('FAQPage');
    checks.push({
      id: 'smoke:pro',
      status: ok ? 'ok' : 'fail',
      message: ok ? 'GET /pro → 200 with FAQPage JSON-LD' : `GET /pro → ${pro.status}`,
    });
  } catch (err) {
    checks.push({ id: 'smoke:pro', status: 'fail', message: `GET /pro error: ${String(err)}` });
  }

  try {
    const td = await get('/teardowns');
    await td.text();
    checks.push({
      id: 'smoke:teardowns',
      status: td.status === 200 ? 'ok' : 'fail',
      message: td.status === 200 ? 'GET /teardowns → 200' : `GET /teardowns → ${td.status}`,
    });
  } catch (err) {
    checks.push({
      id: 'smoke:teardowns',
      status: 'fail',
      message: `GET /teardowns error: ${String(err)}`,
    });
  }

  // 6. Auth & security guards on /admin and /account (must never fail open)
  try {
    const res = await get('/admin', 'manual');
    const loc = res.headers.get('location') ?? '';
    const ok =
      res.status === 302 &&
      loc.startsWith('/admin/login') &&
      res.headers.get('cache-control') === 'no-store' &&
      res.headers.get('x-robots-tag') === 'noindex, nofollow' &&
      res.headers.get('x-frame-options') === 'DENY';
    checks.push({
      id: 'smoke:admin-guard',
      status: ok ? 'ok' : 'fail',
      message: ok
        ? 'GET /admin → 302 /admin/login with no-store, noindex, DENY'
        : `GET /admin guard unexpected (status=${res.status}, loc=${loc})`,
    });
  } catch (err) {
    checks.push({
      id: 'smoke:admin-guard',
      status: 'fail',
      message: `GET /admin error: ${String(err)}`,
    });
  }

  try {
    const res = await get('/account', 'manual');
    const loc = res.headers.get('location') ?? '';
    const ok =
      res.status === 302 &&
      loc === '/sign-in?next=%2Faccount' &&
      res.headers.get('cache-control') === 'no-store' &&
      (res.headers.get('x-robots-tag') ?? '').includes('noindex');
    checks.push({
      id: 'smoke:account-guard',
      status: ok ? 'ok' : 'fail',
      message: ok
        ? 'GET /account → 302 /sign-in?next=%2Faccount with no-store, noindex'
        : `GET /account guard unexpected (status=${res.status}, loc=${loc})`,
    });
  } catch (err) {
    checks.push({
      id: 'smoke:account-guard',
      status: 'fail',
      message: `GET /account error: ${String(err)}`,
    });
  }

  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}

function printResult(label: string, result: PreflightResult) {
  console.log(`\n${label}`);
  for (const c of result.checks) {
    const tag = c.status === 'ok' ? 'ok  ' : c.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  ${tag} [${c.id}] ${c.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const smokeIdx = args.indexOf('--smoke');
  const smokeUrl = smokeIdx !== -1 ? args[smokeIdx + 1] : undefined;

  const rootDir = resolve(new URL('../..', import.meta.url).pathname);
  const cfgResult = auditConfig(rootDir, { strict });
  printResult('Launch config preflight', cfgResult);

  let ok = cfgResult.ok;
  if (smokeUrl) {
    const smokeResult = await runSmokeChecks(smokeUrl);
    printResult(`Smoke checks (${smokeUrl})`, smokeResult);
    ok = ok && smokeResult.ok;
  } else if (smokeIdx !== -1) {
    console.error(
      'Missing URL after --smoke (example: npm run ops:smoke -- http://127.0.0.1:4400)',
    );
    process.exit(2);
  }

  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
