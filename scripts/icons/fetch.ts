/**
 * Mirrors original logos so pages never show a letter tile while a real logo exists:
 *  - apps: the public Shopify App Store listing icon (the icon_url we already store),
 *  - stores: the store's own apple-touch-icon / icon link from its home page (robots.txt and the
 *    VitrineBot user agent respected, one polite fetch per store).
 * Images are resized to ≤128 px WebP into .data/icons/, named with a content hash, and recorded in
 * data/curation/icons.json (the app reads that file; scripts/icons/upload.py puts the files in R2).
 *
 *   node scripts/icons/fetch.ts [--apps] [--stores] [--db <local.sqlite>] [--only a,b]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { parseRobots, ROBOTS_TOKEN } from '../../src/lib/robots.ts';

const ROOT = join(import.meta.dirname, '../..');
const OUT = join(ROOT, '.data/icons');
const MANIFEST = join(ROOT, 'data/curation/icons.json');
const UA = `Mozilla/5.0 (compatible; ${ROBOTS_TOKEN}/1.0; +https://vitrine-preview.iammuneebrafi.workers.dev/methodology#crawler)`;

const { values } = parseArgs({
  options: {
    apps: { type: 'boolean', default: false },
    stores: { type: 'boolean', default: false },
    db: { type: 'string' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '6' },
  },
});
if (!values.apps && !values.stores) values.apps = values.stores = true;
const only = values.only ? new Set(values.only.split(',')) : null;

type Manifest = {
  apps: Record<string, { url: string; key: string }>;
  stores: Record<string, { from: string; key: string }>;
  missing: { apps: string[]; stores: string[] };
};
const manifest: Manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : { apps: {}, stores: {}, missing: { apps: [], stores: [] } };
manifest.missing ??= { apps: [], stores: [] };

const dbPath =
  values.db ??
  (() => {
    const dir = join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    const f = readdirSync(dir).filter((x) => x.endsWith('.sqlite') && !x.startsWith('metadata'))[0];
    return join(dir, f!);
  })();
const db = new DatabaseSync(dbPath, { readOnly: true });

async function get(url: string, accept = '*/*'): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
}

/** sharp cannot read .ico; Pillow can. */
function icoToPng(buf: Buffer): Buffer | null {
  try {
    return execFileSync(
      'python3',
      [
        '-c',
        'import sys,io;from PIL import Image;im=Image.open(io.BytesIO(sys.stdin.buffer.read()));im=im.ico.getimage(max(im.ico.sizes())) if hasattr(im,"ico") else im;o=io.BytesIO();im.convert("RGBA").save(o,"PNG");sys.stdout.buffer.write(o.getvalue())',
      ],
      { input: buf, maxBuffer: 5_000_000 },
    );
  } catch {
    return null;
  }
}

async function toWebp(buf: Buffer): Promise<{ data: Buffer; w: number } | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height || meta.width < 32 || meta.height < 32) return null;
    const side = Math.min(128, Math.max(meta.width, meta.height));
    const data = await sharp(buf)
      .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 88 })
      .toBuffer();
    return { data, w: meta.width };
  } catch {
    return null;
  }
}

function save(kind: 'apps' | 'stores', name: string, data: Buffer): string {
  const hash = createHash('sha1').update(data).digest('hex').slice(0, 8);
  const key = `icons/${kind}/${name}.${hash}.webp`;
  mkdirSync(join(OUT, kind), { recursive: true });
  writeFileSync(join(OUT, kind, `${name}.${hash}.webp`), data);
  return key;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

// ---- apps -------------------------------------------------------------------------------------
async function doApps() {
  const rows = db
    .prepare(`SELECT slug, icon_url FROM apps WHERE icon_url IS NOT NULL AND icon_url != ''`)
    .all() as Array<{ slug: string; icon_url: string }>;
  const todo = rows.filter(
    (r) =>
      !r.icon_url.startsWith('/') &&
      (!only || only.has(r.slug)) &&
      manifest.apps[r.slug]?.url !== r.icon_url,
  );
  console.log(`apps: ${todo.length} to mirror (${rows.length} with an icon)`);
  await pool(todo, Number(values.concurrency), async (r) => {
    try {
      const res = await get(r.icon_url, 'image/*');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = await toWebp(Buffer.from(await res.arrayBuffer()));
      if (!out) throw new Error('too small / undecodable');
      manifest.apps[r.slug] = { url: r.icon_url, key: save('apps', r.slug, out.data) };
    } catch (e) {
      console.log(`  app ${r.slug}: ${String(e).slice(0, 80)}`);
    }
  });
}

// ---- stores -----------------------------------------------------------------------------------
const attr = (tag: string, name: string) =>
  new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
    .exec(tag)
    ?.slice(2, 5)
    .find(Boolean);

function iconCandidates(html: string, base: string): string[] {
  const out: Array<{ url: string; score: number }> = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const sizes = Math.max(
      0,
      ...[...(attr(tag, 'sizes') ?? '').matchAll(/(\d+)x\d+/g)].map((x) => +x[1]!),
    );
    let url: string;
    try {
      url = new URL(href.replace(/&amp;/g, '&'), base).href;
    } catch {
      continue;
    }
    // Shopify's image CDN resizes on request: ask for a crisp square.
    if (/cdn\.shopify\.com/.test(url)) {
      const u = new URL(url);
      u.searchParams.set('width', '256');
      u.searchParams.delete('height');
      url = u.href;
    }
    out.push({ url, score: (rel.includes('apple-touch') ? 1000 : 0) + (sizes || 16) });
  }
  return [...new Set(out.sort((a, b) => b.score - a.score).map((x) => x.url))].slice(0, 4);
}

async function storeLogo(domain: string, url: string | null): Promise<string | null> {
  const home = url ?? `https://${domain}/`;
  const robotsRes = await get(new URL('/robots.txt', home).href).catch(() => null);
  const robots = robotsRes?.ok ? parseRobots(await robotsRes.text()) : null;
  if (robots && !robots.allows(new URL(home).pathname || '/')) return null;
  const res = await get(home, 'text/html').catch(() => null);
  if (!res?.ok) return null;
  const html = (await res.text()).slice(0, 400_000);
  const cands = iconCandidates(html, res.url || home);
  cands.push(new URL('/apple-touch-icon.png', res.url || home).href);
  cands.push(new URL('/favicon.ico', res.url || home).href);
  for (const c of cands) {
    const cu = new URL(c);
    if (robots && cu.hostname === new URL(home).hostname && !robots.allows(cu.pathname + cu.search))
      continue;
    try {
      const r = await get(c, 'image/*');
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) continue;
      let body: Buffer = Buffer.from(await r.arrayBuffer());
      if (/\.ico(\?|$)/i.test(c) || (r.headers.get('content-type') ?? '').includes('icon')) {
        body = icoToPng(body) ?? body;
      }
      const out = await toWebp(body);
      if (!out) continue;
      manifest.stores[domain] = { from: c, key: save('stores', domain, out.data) };
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

async function doStores() {
  const rows = db
    .prepare(
      `SELECT domain, url FROM stores WHERE is_curated = 1 AND status = 'active' ORDER BY domain`,
    )
    .all() as Array<{ domain: string; url: string | null }>;
  const todo = rows.filter((r) => (!only || only.has(r.domain)) && !manifest.stores[r.domain]);
  console.log(`stores: ${todo.length} to fetch (${rows.length} curated)`);
  let n = 0;
  await pool(todo, Number(values.concurrency), async (r) => {
    const got = await storeLogo(r.domain, r.url).catch(() => null);
    if (!got && !manifest.missing.stores.includes(r.domain)) manifest.missing.stores.push(r.domain);
    if (got) manifest.missing.stores = manifest.missing.stores.filter((d) => d !== r.domain);
    if (++n % 25 === 0) console.log(`  ${n}/${todo.length}`);
  });
}

/** Apps without a stored icon: the listing page's own icon, else the developer site's logo. */
async function doMissingApps() {
  const rows = db
    .prepare(
      `SELECT slug, app_store_url, website_url FROM apps WHERE status = 'active' AND (icon_url IS NULL OR icon_url = '') AND name NOT LIKE 'Oh no%'`,
    )
    .all() as Array<{ slug: string; app_store_url: string | null; website_url: string | null }>;
  for (const r of rows.filter((x) => !manifest.apps[x.slug] && (!only || only.has(x.slug)))) {
    try {
      if (r.app_store_url) {
        const res = await get(r.app_store_url, 'text/html');
        const m = res.ok
          ? /https:\/\/cdn\.shopify\.com\/app-store\/listing_images\/[^"'\s)]+\/icon\/[^"'\s)]+/.exec(
              await res.text(),
            )
          : null;
        const url = m?.[0].replace(/&amp;/g, '&');
        if (url) {
          const img = await get(url, 'image/*');
          const out = img.ok ? await toWebp(Buffer.from(await img.arrayBuffer())) : null;
          if (out) {
            manifest.apps[r.slug] = { url, key: save('apps', r.slug, out.data) };
            continue;
          }
        }
      }
      if (r.website_url) {
        const host = new URL(r.website_url).hostname.replace(/^www\./, '');
        if (await storeLogo(host, r.website_url)) {
          const hit = manifest.stores[host]!;
          manifest.apps[r.slug] = { url: hit.from, key: hit.key.replace('/stores/', '/apps/') };
          const src = join(OUT, 'stores', hit.key.split('/').pop()!);
          mkdirSync(join(OUT, 'apps'), { recursive: true });
          writeFileSync(
            join(ROOT, '.data/icons', manifest.apps[r.slug]!.key.replace(/^icons\//, '')),
            readFileSync(src),
          );
          delete manifest.stores[host];
          manifest.missing.stores = manifest.missing.stores.filter((d) => d !== host);
        }
      }
    } catch (e) {
      console.log(`  app ${r.slug}: ${String(e).slice(0, 80)}`);
    }
  }
}

if (values.apps) await doApps();
if (values.apps) await doMissingApps();
if (values.stores) await doStores();
manifest.missing.apps = (
  db.prepare(`SELECT slug FROM apps WHERE status='active'`).all() as Array<{ slug: string }>
)
  .map((r) => r.slug)
  .filter((s) => !manifest.apps[s]);
const sorted = <T>(o: Record<string, T>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
manifest.apps = sorted(manifest.apps);
manifest.stores = sorted(manifest.stores);
manifest.missing.stores.sort();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(
  `manifest: ${Object.keys(manifest.apps).length} app icons, ${Object.keys(manifest.stores).length} store logos; missing ${manifest.missing.apps.length} apps, ${manifest.missing.stores.length} stores`,
);
