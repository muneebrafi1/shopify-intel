#!/usr/bin/env node
/// <reference types="node" />
/**
 * Precompute catalog JSON for every public page type from a local sqlite snapshot, then
 * (optionally) upload it to the existing R2 media bucket. Run after d1-sync, before deploy.
 *
 *   node --import <json-register> scripts/ops/rebuild-page-cache.ts \
 *     --local-file <snapshot.sqlite> --out-dir /tmp/page-cache \
 *     [--origin https://vitrine-preview.iammuneebrafi.workers.dev] [--upload] [--skip-sections]
 *
 * R2 keys: page-cache/<data_version>/<method>/<key>.json plus page-cache/manifest.json.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createApiClient, type ApiClient } from '../../src/server/api/v1/client.ts';
import { ApiError } from '../../src/server/api/v1/errors.ts';
import {
  pageCacheRef,
  r2ObjectKey,
  stableKey,
  type PageCacheManifest,
} from '../../src/server/page-cache.ts';
import { openNodeDb } from '../../src/server/db/node-sqlite.ts';
import { createNotifier } from '../../src/server/notify.ts';
import { loadDataInfo } from '../../src/server/api/v1/context.ts';
import { APP_CATEGORY_SURFACES } from '../../src/lib/taxonomy.ts';
import {
  buildCoreSitemap,
  buildSectionsSitemap,
  buildSitemapIndex,
} from '../../src/server/repo/sitemap.ts';
import galleryManifest from '../../data/curation/home-gallery.json' with { type: 'json' };

const { values } = parseArgs({
  options: {
    'local-file': { type: 'string' },
    'out-dir': { type: 'string' },
    origin: { type: 'string', default: 'https://vitrine-preview.iammuneebrafi.workers.dev' },
    upload: { type: 'boolean', default: false },
    'skip-sections': { type: 'boolean', default: false },
    limit: { type: 'string' },
  },
});
if (!values['local-file'] || !values['out-dir']) {
  console.error(
    'Usage: rebuild-page-cache.ts --local-file <sqlite> --out-dir <dir> [--origin <url>] [--upload] [--skip-sections]',
  );
  process.exit(1);
}

const src = resolve(values['local-file']);
const outDir = resolve(values['out-dir']);
const origin = values.origin ?? 'https://vitrine-preview.iammuneebrafi.workers.dev';
const skipSections = Boolean(values['skip-sections']);
const limit = values.limit ? Number(values.limit) : Infinity;
mkdirSync(outDir, { recursive: true });

const copy = join(outDir, 'work.sqlite');
copyFileSync(src, copy);
for (const suffix of ['-wal', '-shm']) {
  try {
    copyFileSync(src + suffix, copy + suffix);
  } catch {
    /* no WAL */
  }
}

const db = openNodeDb(copy);
const data = await loadDataInfo(db);
const version = data.dataVersion;
const api: ApiClient = createApiClient({
  db,
  env: {},
  notifier: createNotifier({ log: () => {} }),
  now: () => new Date(),
  waitUntil: null,
  mediaStore: null,
  validateOutput: false,
});

const filesDir = join(outDir, 'objects');
const counts: Record<string, number> = {};
let written = 0;
let failed = 0;
const t0 = Date.now();

function objectPath(type: string, key: string): { rel: string; abs: string } {
  const rel = r2ObjectKey(version, type, key);
  return { rel, abs: join(filesDir, rel) };
}

async function save(method: string, input: Record<string, unknown>, payload: unknown) {
  const ref = pageCacheRef(method, input);
  if (!ref) return;
  const { rel, abs } = objectPath(ref.type, ref.key);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, JSON.stringify(payload));
  counts[method] = (counts[method] ?? 0) + 1;
  written += 1;
}

async function put(method: string, input: Record<string, unknown> = {}) {
  try {
    const fn = api[method as keyof ApiClient] as (i?: unknown) => Promise<unknown>;
    const payload = await fn(input);
    await save(method, input, payload);
    return payload as { data?: unknown; meta?: { pagination?: { next_cursor?: string | null } } };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    failed += 1;
    console.error(
      `  fail ${method} ${stableKey(input)}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

async function walk(method: string, input: Record<string, unknown>, cursorKey = 'cursor') {
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const payload = await put(method, cursor ? { ...input, [cursorKey]: cursor } : { ...input });
    pages += 1;
    const next = payload?.meta?.pagination?.next_cursor ?? null;
    if (!next || pages > 500) break;
    cursor = next;
  }
}

function progress(msg: string) {
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  [${dt}s] ${msg}  written=${written} fail=${failed}`);
}

const cap = <T>(xs: T[]): T[] => (Number.isFinite(limit) ? xs.slice(0, Number(limit)) : xs);

progress(`snapshot data_version=${version} origin=${origin}`);

// ---- Meta & indexes ------------------------------------------------------------------
await put('getMeta', {});
await put('index', {});
await put('listTeardowns', {});
await put('listAppCategories', {});
await put('listAlternatives', {});
await put('listSectionTypes', {});
await put('listComparisons', { limit: 200 });
await put('listComparisons', { kind: 'app', limit: 200 });
await put('listComparisons', { kind: 'theme', limit: 200 });
await put('listThemes', { limit: 5 });
await put('listThemes', { limit: 1 });
await put('listThemes', { sort: 'usage', limit: 48 });
await put('listThemes', { limit: 100, sort: 'usage' });
await put('listApps', { limit: 24 });
await put('listApps', { sort: 'usage', limit: 24 });
await put('listApps', { sort: 'usage', limit: 60 });
await put('listApps', { limit: 1, sort: 'usage' });
await walk('listApps', { sort: 'usage', limit: 24 });
await walk('listApps', { sort: 'usage', limit: 60 });
await walk('listStores', { scope: 'curated', sort: 'rank', limit: 60 });
await walk('listStores', { scope: 'all', limit: 60 });
await put('listStores', { scope: 'curated', limit: 1 });
await put('listStores', {
  domains: (galleryManifest as { tiles: { domain: string }[] }).tiles.map((t) => t.domain),
  limit: 60,
  facets: false,
});
await put('listSections', { type: 'header', page_type: 'home', limit: 40, facets: false });
await walk('listSections', { sort: 'mixed', limit: 24 });
progress('indexes done');

// ---- Stores --------------------------------------------------------------------------
const stores = cap(
  await db.all<{ domain: string }>(
    "SELECT domain FROM stores WHERE status = 'active' AND is_captured = 1 ORDER BY list_position",
  ),
);
for (const [i, s] of stores.entries()) {
  await put('getStore', { domain: s.domain });
  if ((i + 1) % 100 === 0) progress(`stores ${i + 1}/${stores.length}`);
}
progress(`stores ${stores.length}`);

const categories = cap(
  await db.all<{ slug: string }>(
    "SELECT DISTINCT category_slug AS slug FROM stores WHERE status = 'active' AND is_curated = 1 AND category_slug IS NOT NULL ORDER BY category_slug",
  ),
);
for (const c of categories) {
  await walk('listStores', { scope: 'curated', category: c.slug, limit: 48 });
}
progress(`galleries ${categories.length}`);

// ---- Apps, alternatives, app stores --------------------------------------------------
const apps = cap(
  await db.all<{ slug: string; category: string | null }>(
    `SELECT a.slug, ac.name AS category FROM apps a
     LEFT JOIN app_categories ac ON ac.id = a.category_id
     WHERE a.status = 'active' ORDER BY a.slug`,
  ),
);
const catSlugs = [
  ...new Set(
    (await db.all<{ slug: string }>('SELECT slug FROM app_categories ORDER BY slug')).map(
      (r) => r.slug,
    ),
  ),
];
for (const c of catSlugs) {
  await put('listApps', { category: c, sort: 'usage', limit: 100 });
  await walk('listApps', { category: c, limit: 24 });
}
for (const [i, a] of apps.entries()) {
  await put('getApp', { slug: a.slug, stores_limit: 24 });
  await put('getAlternatives', { slug: a.slug });
  await put('getAlternatives', { slug: a.slug, kind: 'app' });
  await put('listStores', { app: a.slug, captured: true, limit: 12, facets: false });
  await walk('listAppStores', { slug: a.slug, limit: 24 });
  if (a.category) {
    const surface = (APP_CATEGORY_SURFACES[a.category] ?? [])[0];
    if (surface) {
      const alts = (await api.getAlternatives({ slug: a.slug, kind: 'app' }).catch(() => null)) as {
        data?: { items?: Array<{ app?: { slug?: string } | null }>; slug?: string };
      } | null;
      const wanted = [
        a.slug,
        ...((alts?.data?.items ?? []).map((it) => it.app?.slug).filter(Boolean) as string[]),
      ];
      if (wanted.length) {
        await put('listSectionsByApps', {
          apps: wanted,
          type: surface,
          device: 'desktop',
          per_app: 1,
        });
      }
    }
  }
  if ((i + 1) % 50 === 0) progress(`apps ${i + 1}/${apps.length}`);
}
// Category-page listSectionsByApps for leaders × devices
for (const c of catSlugs) {
  const list = (await api.listApps({ category: c, sort: 'usage', limit: 100 })) as {
    data: { items: { slug: string }[] };
  };
  const leaders = list.data.items.slice(0, 8).map((x) => x.slug);
  if (leaders.length) {
    await put('listSectionsByApps', { apps: leaders, device: 'desktop', per_app: 4 });
    await put('listSectionsByApps', { apps: leaders, device: 'mobile', per_app: 4 });
  }
}
progress(`apps ${apps.length}`);

// ---- Themes --------------------------------------------------------------------------
const themes = cap(
  await db.all<{ slug: string }>("SELECT slug FROM themes WHERE status = 'active' ORDER BY slug"),
);
for (const t of themes) {
  await put('getTheme', { slug: t.slug, stores_limit: 0 });
  await put('getAlternatives', { slug: t.slug });
  await put('getAlternatives', { slug: t.slug, kind: 'theme' });
  await walk('listStores', { theme: t.slug, scope: 'all', limit: 24 });
  await walk('listStores', { theme: t.slug, scope: 'curated', sort: 'rank', limit: 48 });
}
progress(`themes ${themes.length}`);

// ---- Compare -------------------------------------------------------------------------
const pairs = cap(
  await db.all<{ slug: string; kind: string }>(
    'SELECT slug, kind FROM comparisons ORDER BY kind, slug',
  ),
);
for (const p of pairs) {
  const env = await put('getComparison', { pair: p.slug });
  const related = (
    env as {
      data?: { related?: Array<{ a: { slug: string }; b: { slug: string } }>; apps?: unknown };
    } | null
  )?.data?.related;
  if (related?.length) {
    const slugs = [...new Set(related.flatMap((r) => [r.a.slug, r.b.slug]))];
    const lookup = { slugs, limit: 100, facets: false };
    if ((env as { data?: { apps?: unknown } })?.data?.apps) await put('listApps', lookup);
    else await put('listThemes', lookup);
  }
}
progress(`compare ${pairs.length}`);

// ---- Teardowns & screenshots used on theme/about pages -------------------------------
const teardowns = cap(
  await db.all<{ slug: string }>(
    'SELECT slug FROM teardowns WHERE published_at IS NOT NULL ORDER BY slug',
  ),
);
for (const t of teardowns) await put('getTeardown', { slug: t.slug });

const shots = cap(
  await db.all<{ id: number }>('SELECT id FROM screenshots WHERE is_current = 1 ORDER BY id'),
);
if (!skipSections) {
  for (const [i, s] of shots.entries()) {
    await put('getScreenshot', { id: s.id });
    if ((i + 1) % 500 === 0) progress(`screenshots ${i + 1}/${shots.length}`);
  }
  progress(`screenshots ${shots.length}`);
}

// ---- Section types (paginated) and section details -----------------------------------
const types = cap(
  await db.all<{ slug: string }>(
    'SELECT DISTINCT section_type AS slug FROM sections WHERE is_current = 1 ORDER BY section_type',
  ),
);
for (const t of types) {
  await walk('listSections', { type: t.slug, sort: 'mixed', limit: 24 });
  await put('listSections', { type: t.slug, sort: 'mixed', limit: 60 });
}
progress(`section-types ${types.length}`);

if (!skipSections) {
  const sectionIds = cap(
    await db.all<{ id: number }>(
      `SELECT s.id FROM sections s
       JOIN stores st ON st.id = s.store_id AND st.status = 'active'
       WHERE s.is_current = 1 ORDER BY s.id`,
    ),
  );
  for (const [i, s] of sectionIds.entries()) {
    await put('getSection', { id: s.id });
    if ((i + 1) % 1000 === 0) progress(`sections ${i + 1}/${sectionIds.length}`);
  }
  progress(`sections ${sectionIds.length}`);
}

// ---- Sitemaps ------------------------------------------------------------------------
const sitemaps = {
  index: await buildSitemapIndex(db, origin),
  core: await buildCoreSitemap(db, origin),
  sections: await buildSectionsSitemap(db, origin),
};
for (const [name, xml] of Object.entries(sitemaps)) {
  const { abs } = objectPath('sitemaps', name);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, JSON.stringify({ xml }));
  counts['sitemaps'] = (counts['sitemaps'] ?? 0) + 1;
  written += 1;
}
progress('sitemaps done');

const manifest: PageCacheManifest = {
  version,
  built_at: new Date().toISOString(),
  counts: { ...counts, files: written, failed },
};
const manifestAbs = join(filesDir, 'page-cache/manifest.json');
mkdirSync(join(manifestAbs, '..'), { recursive: true });
writeFileSync(manifestAbs, JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
progress(`done files=${written} fail=${failed} version=${version}`);

// Manifest for wrangler r2 bulk put (every object except work.sqlite)
const { readdirSync, statSync } = await import('node:fs');
function walkFiles(dir: string, acc: { key: string; file: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkFiles(abs, acc);
    else {
      const key = abs.slice(filesDir.length + 1);
      acc.push({ key, file: abs });
    }
  }
  return acc;
}
const manifestList = walkFiles(filesDir);
manifestList.sort((a, b) => {
  const am = a.key.endsWith('page-cache/manifest.json') ? 1 : 0;
  const bm = b.key.endsWith('page-cache/manifest.json') ? 1 : 0;
  return am - bm;
});
writeFileSync(join(outDir, 'r2-manifest.json'), JSON.stringify(manifestList));
console.log(`r2-manifest ${manifestList.length} objects`);

if (values.upload) {
  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? '29e44e31c0040fcc3bf1d86a3ab0ccf0',
    WRANGLER_SEND_METRICS: 'false',
    AI_AGENT: '',
    CLAUDECODE: '',
    CI: '1',
  };
  const cfg = process.env.WRANGLER_CONFIG ?? '/home/box/preview/wrangler.preview.jsonc';
  const CHUNK = 80;
  const cwd = resolve(new URL('../../', import.meta.url).pathname);
  const sleep = (ms: number) => spawnSync('sleep', [String(ms / 1000)]);
  for (let i = 0; i < manifestList.length; i += CHUNK) {
    const part = manifestList.slice(i, i + CHUNK);
    const fn = join(outDir, `r2-chunk-${String(Math.floor(i / CHUNK) + 1).padStart(4, '0')}.json`);
    writeFileSync(fn, JSON.stringify(part));
    let attempt = 0;
    let ok = false;
    while (attempt < 10 && !ok) {
      attempt++;
      const r = spawnSync(
        'npx',
        [
          'wrangler',
          'r2',
          'bulk',
          'put',
          'vitrine-preview-media',
          '--remote',
          '-f',
          fn,
          '--ct',
          'application/json',
          '--cc',
          'public, max-age=3600',
          '--concurrency',
          '4',
          '-y',
          '--config',
          cfg,
        ],
        { env, cwd, encoding: 'utf8' },
      );
      const out = (r.stdout ?? '') + (r.stderr ?? '');
      if (r.status === 0) {
        ok = true;
        console.log(`uploaded ${Math.min(i + CHUNK, manifestList.length)}/${manifestList.length}`);
      } else {
        const rate = /429|Too Many Requests/i.test(out);
        const wait = rate ? Math.min(180, 20 * 2 ** (attempt - 1)) : Math.min(30, 5 * attempt);
        console.error(`upload FAIL ${fn} attempt ${attempt} (retry in ${wait}s)`, out.slice(-400));
        if (attempt >= 10) process.exit(1);
        sleep(wait * 1000);
      }
    }
    sleep(3000);
  }
}
db.close();
