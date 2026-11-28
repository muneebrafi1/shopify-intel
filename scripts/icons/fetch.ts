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
    refetch: { type: 'boolean', default: false },
    'refetch-weak': { type: 'boolean', default: false },
  },
});
if (!values.apps && !values.stores) values.apps = values.stores = true;
const only = values.only ? new Set(values.only.split(',')) : null;
const refetch = Boolean(values.refetch);
const refetchWeak = Boolean(values['refetch-weak']);

type Manifest = {
  apps: Record<string, { url: string; key: string }>;
  stores: Record<string, { from: string; key: string; w?: number; h?: number }>;
  themes?: Record<string, { from: string; key: string; w?: number; h?: number }>;
  missing: { apps: string[]; stores: string[]; themes?: string[] };
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
  let delay = 2000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 429 && res.status !== 503) return res;
    const ra = res.headers.get('retry-after');
    const wait = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : delay;
    await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
    delay = Math.min(delay * 2, 20_000);
  }
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

async function toWebp(buf: Buffer): Promise<{ data: Buffer; w: number; h: number } | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    // Wordmarks are often wide and short (e.g. 112×22); accept if the long side is ≥ 32.
    if (Math.max(meta.width, meta.height) < 32) return null;
    // Tight crop of transparent/same-colour margins so wordmarks fill the tile.
    const trimmed = await sharp(buf)
      .trim({ threshold: 16 })
      .toBuffer()
      .catch(() => buf);
    const tmeta = await sharp(trimmed).metadata();
    const src = tmeta.width && tmeta.height ? trimmed : buf;
    // Quality-check the trimmed source, not the padded square — a wide wordmark in a
    // 128×128 tile is mostly transparency and would fail an opaque-pixel ratio.
    const probe = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let lum = 0, n = 0, lum2 = 0;
    const totalPx = probe.data.length / 4;
    for (let i = 0; i < probe.data.length; i += 4) {
      if (probe.data[i + 3]! > 40) {
        const L = probe.data[i]! * 0.3 + probe.data[i + 1]! * 0.59 + probe.data[i + 2]! * 0.11;
        lum += L;
        lum2 += L * L;
        n++;
      }
    }
    if (n < totalPx * 0.06) return null;
    if (n > totalPx * 0.95) {
      const mean = lum / n;
      const variance = lum2 / n - mean * mean;
      if (variance < 25) return null;
    }
    const tw = tmeta.width ?? meta.width;
    const th = tmeta.height ?? meta.height;
    const long = Math.max(tw, th);
    const side = Math.min(128, long);
    const nw = Math.max(1, Math.round((tw / long) * side));
    const nh = Math.max(1, Math.round((th / long) * side));
    const fitted = sharp(src).resize(nw, nh, { fit: 'inside' }).ensureAlpha();
    // Light marks on transparency vanish on our white tile; sit them on ink instead.
    const pipeline =
      n && lum / n > 210
        ? fitted.flatten({ background: '#191816' })
        : fitted;
    const data = await pipeline.webp({ quality: 88 }).toBuffer();
    const outMeta = await sharp(data).metadata();
    return { data, w: outMeta.width ?? nw, h: outMeta.height ?? nh };
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

function absUrl(href: string, base: string): string | null {
  try {
    let url = new URL(href.replace(/&amp;/g, '&').replace(/\\u0026/g, '&'), base).href;
    // Shopify's image CDN, including the store's own /cdn/shop/ host.
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) {
      const u = new URL(url);
      u.searchParams.set('width', '256');
      u.searchParams.delete('height');
      u.searchParams.delete('crop');
      url = u.href;
    }
    return url;
  } catch {
    return null;
  }
}

function hostTokens(base: string): string[] {
  try {
    const label = new URL(base).hostname.replace(/^www\./, '').split('.')[0] ?? '';
    const toks = new Set<string>([label]);
    for (const p of ['the', 'my', 'get', 'shop', 'try', 'buy']) {
      if (label.startsWith(p) && label.length - p.length >= 4) toks.add(label.slice(p.length));
    }
    return [...toks].filter((t) => t.length >= 4);
  } catch {
    return [];
  }
}

function nameHit(href: string, tokens: string[]): boolean {
  const file = (href.split('?')[0]?.split('/').pop() ?? '').toLowerCase();
  for (const tok of tokens) {
    if (file.includes(tok)) return true;
    for (const part of file.split(/[^a-z0-9]+/).filter((t) => t.length >= 5)) {
      if (tok.startsWith(part) || part.startsWith(tok)) return true;
    }
  }
  return false;
}

function logoCandidates(html: string, base: string): Array<{ url: string; score: number }> {
  const out: Array<{ url: string; score: number }> = [];
  const tokens = hostTokens(base);
  const add = (href: string | undefined | null, score: number) => {
    if (!href || href.startsWith('data:')) return;
    const url = absUrl(href, base);
    if (!url) return;
    out.push({ url, score: score + (nameHit(url, tokens) ? 500 : 0) });
  };

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    if (href && /manifest/.test(rel)) add(href, -1); // scored later after the manifest is fetched
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const sizes = Math.max(
      0,
      ...[...(attr(tag, 'sizes') ?? '').matchAll(/(\d+)x\d+/g)].map((x) => +x[1]!),
    );
    add(href, (rel.includes('apple-touch') ? 1000 : 0) + (sizes || 16));
  }

  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const raw = JSON.parse(m[1]!.replace(/^\s*\/\*/, '').replace(/\*\/\s*$/, ''));
      const nodes = Array.isArray(raw) ? raw : raw?.['@graph'] ? raw['@graph'] : [raw];
      const walk = (n: unknown) => {
        if (!n || typeof n !== 'object') return;
        const o = n as Record<string, unknown>;
        const typ = String(o['@type'] ?? '').toLowerCase();
        if (typ.includes('organization') || typ.includes('brand') || typ.includes('webstore')) {
          const logo = o.logo as unknown;
          const href =
            typeof logo === 'string'
              ? logo
              : logo && typeof logo === 'object'
                ? String(
                    (logo as { url?: string; contentUrl?: string }).url ??
                      (logo as { contentUrl?: string }).contentUrl ??
                      '',
                  )
                : '';
          if (href) add(href, 2000);
        }
        if (Array.isArray(o['@graph'])) o['@graph'].forEach(walk);
      };
      (Array.isArray(nodes) ? nodes : [nodes]).forEach(walk);
    } catch {
      /* ignore broken JSON-LD */
    }
  }

  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const prop = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    const content = attr(tag, 'content');
    if (!content) continue;
    if (prop === 'og:logo' || prop === 'twitter:image' && /logo/i.test(content)) add(content, 1600);
    if ((prop === 'og:image' || prop === 'og:image:url') && /logo/i.test(content)) add(content, 1500);
  }

  const head = html.slice(0, 250_000);
  for (const m of head.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src =
      attr(tag, 'src') ??
      attr(tag, 'data-src') ??
      (attr(tag, 'srcset') ?? attr(tag, 'data-srcset') ?? '').split(/[\s,]/).find(Boolean);
    const blob = `${src ?? ''} ${attr(tag, 'alt') ?? ''} ${attr(tag, 'class') ?? ''} ${attr(tag, 'id') ?? ''}`;
    if (src && /logo|brandmark|site-title|wordmark/i.test(blob)) add(src, 1300);
  }

  // Filenames in the HTML (srcset, CSS, JSON) often carry the real wordmark when the
  // <img> itself has no "logo" class — e.g. Negative_Wordmark_*.svg, sill_logo_new.png.
  for (const m of html.matchAll(
    /(?:https?:)?\/\/[^"'\s)]+\/cdn\/shop\/(?:files|t\/[^/]+\/assets)\/[^"'\s)]+/gi,
  )) {
    const href = m[0].replace(/&amp;/g, '&');
    const file = (href.split('?')[0]?.split('/').pop() ?? '').toLowerCase();
    if (/logo|wordmark|brandmark|logomark|brand-bar|site-logo/.test(file)) {
      add(href, /wordmark|logomark|logo/.test(file) ? 1800 : 1700);
    }
  }

  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}

async function storeLogo(domain: string, url: string | null): Promise<string | null> {
  const home = url ?? `https://${domain}/`;
  const robotsRes = await get(new URL('/robots.txt', home).href).catch(() => null);
  const robots = robotsRes?.ok ? parseRobots(await robotsRes.text()) : null;
  if (robots && !robots.allows(new URL(home).pathname || '/')) return null;
  const res = await get(home, 'text/html').catch(() => null);
  if (!res?.ok) return null;
  const html = (await res.text()).slice(0, 400_000);
  const base = res.url || home;
  const scored = logoCandidates(html, base);
  const manifestLink = scored.find((x) => x.score === -1);
  const cands = scored.filter((x) => x.score >= 0).map((x) => x.url);
  if (manifestLink) {
    try {
      const mu = new URL(manifestLink.url);
      const sameHost = mu.hostname === new URL(home).hostname;
      if (!(robots && sameHost && !robots.allows(mu.pathname + mu.search))) {
        const mr = await get(manifestLink.url, 'application/manifest+json, application/json');
        if (mr.ok) {
          const man = (await mr.json()) as { icons?: Array<{ src?: string; sizes?: string }> };
          for (const icon of man.icons ?? []) {
            if (!icon.src) continue;
            const sizes = Math.max(
              0,
              ...[...(icon.sizes ?? '').matchAll(/(\d+)x\d+/g)].map((x) => +x[1]!),
            );
            const url = absUrl(icon.src, manifestLink.url);
            if (url) cands.unshift(url); // largest first after we sort below; just prepend
            void sizes;
          }
        }
      }
    } catch {
      /* ignore a broken manifest */
    }
  }
  cands.push(new URL('/apple-touch-icon.png', base).href);
  cands.push(new URL('/favicon.ico', base).href);
  const tried = new Set<string>();
  for (const c of cands) {
    if (tried.has(c)) continue;
    tried.add(c);
    const cu = new URL(c);
    if (robots && cu.hostname === new URL(home).hostname && !robots.allows(cu.pathname + cu.search))
      continue;
    try {
      const r = await get(c, 'image/*');
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !(type.startsWith('image/') || type.includes('octet-stream') || /\.ico(\?|$)/i.test(c)))
        continue;
      let body: Buffer = Buffer.from(await r.arrayBuffer());
      if (/\.ico(\?|$)/i.test(c) || type.includes('icon')) {
        body = icoToPng(body) ?? body;
      }
      // Skip obvious og-style wide photos used as a fallback when the URL isn't a logo.
      const meta = await sharp(body).metadata().catch(() => null);
      if (meta?.width && meta.height) {
        const ratio = meta.width / meta.height;
        const looksLikePhoto = ratio > 1.6 || ratio < 0.5;
        const namedLogo = /logo|icon|brand|wordmark|logomark/i.test(c);
        const isSvg = /\.svg(\?|$)/i.test(c) || (meta.format === "svg");
        if (looksLikePhoto && !namedLogo && !isSvg && (meta.width > 400 || meta.height > 400)) continue;
      }
      const out = await toWebp(body);
      if (!out) continue;
      manifest.stores[domain] = { from: c, key: save('stores', domain, out.data), w: out.w, h: out.h };
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
  const weak = new Set<string>();
  if (refetchWeak) {
    for (const [domain, rec] of Object.entries(manifest.stores)) {
      if (/(?:width|height)=32|crop=center|favicon|apple-touch/i.test(rec.from)) weak.add(domain);
    }
  }
  const todo = rows.filter((r) => {
    if (only && !only.has(r.domain)) return false;
    if (!manifest.stores[r.domain]) return true;
    return refetch || weak.has(r.domain);
  });
  console.log(
    `stores: ${todo.length} to fetch (${rows.length} curated; refetch=${refetch} weak=${weak.size})`,
  );
  let n = 0;
  await pool(todo, Number(values.concurrency), async (r) => {
    const prev = manifest.stores[r.domain];
    const got = await storeLogo(r.domain, r.url).catch(() => null);
    if (!got && !prev && !manifest.missing.stores.includes(r.domain)) manifest.missing.stores.push(r.domain);
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
manifest.missing.stores = (
  db
    .prepare(`SELECT domain FROM stores WHERE is_curated = 1 AND status = 'active'`)
    .all() as Array<{ domain: string }>
)
  .map((r) => r.domain)
  .filter((d) => !manifest.stores[d]);
const sorted = <T>(o: Record<string, T>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
manifest.apps = sorted(manifest.apps);
manifest.stores = sorted(manifest.stores);
if (manifest.themes) manifest.themes = sorted(manifest.themes);
manifest.missing.stores.sort();
if (manifest.missing.themes) manifest.missing.themes.sort();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(
  `manifest: ${Object.keys(manifest.apps).length} app icons, ${Object.keys(manifest.stores).length} store logos${manifest.themes ? `, ${Object.keys(manifest.themes).length} theme marks` : ''}; missing ${manifest.missing.apps.length} apps, ${manifest.missing.stores.length} stores`,
);
