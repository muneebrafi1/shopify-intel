#!/usr/bin/env node
/**
 * Typographic Open Graph / Twitter images (1200×630) for catalog pages.
 * Run after captures are on disk, as part of every batch:
 *
 *   npm run ops:og-images -- --out-dir /tmp/og --upload
 *
 * Writes og/home.jpg, og/store/<domain>.jpg, og/app/<slug>.jpg, og/theme/<slug>.jpg,
 * og/gallery/<slug>.jpg, og/compare/<pair>.jpg and og/compare.jpg into the media bucket.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const SQLITE = process.env.SQLITE3 ?? '/home/box/Android/platform-tools/sqlite3';
const W = 1200;
const H = 630;
const LEFT = 520;
const ACCENT = '#cf4519';
const INK = '#111113';
const INK2 = '#52525b';
const INK3 = '#71717a';
const LINE = '#e4e4e7';
const BG = '#ffffff';
const FONT = 'Inter, Instrument Sans, sans-serif';
const MONO = 'Geist, Geist Mono, IBM Plex Mono, DejaVu Sans Mono, monospace';

const { values } = parseArgs({
  options: {
    'local-file': { type: 'string' },
    'out-dir': { type: 'string', default: '/tmp/og-share' },
    upload: { type: 'boolean', default: false },
    limit: { type: 'string' },
  },
});

const outDir = resolve(values['out-dir']);
const filesDir = join(outDir, 'objects');
const snap =
  values['local-file'] ??
  (existsSync('/home/box/preview/p8-r8.sqlite')
    ? '/home/box/preview/p8-r8.sqlite'
    : join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'));
const iconRoot = join(ROOT, '.data/icons');
const captureRoot = join(ROOT, '.data/captures/objects');
const iconsJson = existsSync(join(ROOT, 'data/curation/icons.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data/curation/icons.json'), 'utf8'))
  : { stores: {}, apps: {}, themes: {} };
const BAD_ICON = /magazine|press[-_]?logo|award|badge|people[_-]?magazine/i;
const limit = values.limit ? Number(values.limit) : Infinity;

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function sql(q) {
  if (!existsSync(snap) || !existsSync(SQLITE)) return [];
  try {
    const out = execFileSync(SQLITE, ['-json', snap, q], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.trim() ? JSON.parse(out) : [];
  } catch (e) {
    // older sqlite3 has no -json
    try {
      const out = execFileSync(SQLITE, ['-separator', '\t', snap, q], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      return out;
    } catch {
      return [];
    }
  }
}

function latestIcon(kind, key) {
  // Theme "icons" in this repo are often Theme Store screenshots, not marks.
  if (kind === 'theme') return null;
  const group = kind === 'store' ? 'stores' : kind === 'app' ? 'apps' : 'themes';
  const meta = iconsJson[group]?.[key];
  if (meta?.from && BAD_ICON.test(String(meta.from))) return null;
  const dir = join(iconRoot, group);
  if (!existsSync(dir)) return null;
  const prefix = `${key}.`;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && /\.(webp|png|jpe?g)$/i.test(f))
    .map((f) => join(dir, f))
    .filter((f) => {
      try {
        return statSync(f).size >= 200;
      } catch {
        return false;
      }
    });
  if (!files.length) return null;
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

function uniqueExisting(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths ?? []) {
    if (p && existsSync(p) && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function latestShot(domain) {
  const dir = join(captureRoot, 'shots', domain, 'home', 'desktop');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.og.jpg') || (f.endsWith('.webp') && !f.includes('.top')))
    .sort();
  if (!files.length) return null;
  const og = files.filter((f) => f.endsWith('.og.jpg')).at(-1);
  const full = files.filter((f) => f.endsWith('.webp')).at(-1);
  return join(dir, og ?? full);
}

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function markSvg(x, y, scale = 2) {
  return `<g transform="translate(${x}, ${y}) scale(${scale})">
      <rect width="20" height="20" rx="5.5" fill="${ACCENT}"/>
      <rect x="4.5" y="4.5" width="11" height="5.5" rx="1.5" fill="#ffffff"/>
      <rect x="4.5" y="11.6" width="11" height="1.7" rx="0.85" fill="#ffffff" opacity="0.72"/>
      <rect x="4.5" y="14.5" width="6.5" height="1.7" rx="0.85" fill="#ffffff" opacity="0.5"/>
    </g>`;
}

function textPanel({ eyebrow, title, meta, footer, hasLogo }) {
  const titleLines = wrapText(title, 18);
  const titleSize = titleLines.some((l) => l.length > 16) ? 42 : titleLines.length > 2 ? 40 : 48;
  const titleStart = hasLogo ? 272 : 210;
  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="56" y="${titleStart + i * (titleSize + 8)}" font-family="${FONT}" font-size="${titleSize}" font-weight="600" letter-spacing="-0.03em" fill="${INK}">${esc(line)}</text>`,
    )
    .join('\n');
  const metaY = titleStart + titleLines.length * (titleSize + 8) + 16;
  const metaLines = wrapText(meta ?? '', 36);
  const metaSvg = metaLines
    .map(
      (line, i) =>
        `<text x="56" y="${metaY + i * 26}" font-family="${FONT}" font-size="20" font-weight="400" fill="${INK2}">${esc(line)}</text>`,
    )
    .join('\n');
  return `
    <rect width="${LEFT}" height="${H}" fill="${BG}"/>
    <rect x="0" y="0" width="6" height="${H}" fill="${ACCENT}"/>
    ${markSvg(56, 52, 1.8)}
    <text x="104" y="84" font-family="${FONT}" font-size="26" font-weight="600" letter-spacing="-0.02em" fill="${INK}">Vitrine</text>
    <text x="56" y="150" font-family="${MONO}" font-size="13" font-weight="500" letter-spacing="0.08em" fill="${INK3}">${esc((eyebrow ?? '').toUpperCase())}</text>
    ${titleSvg}
    ${metaSvg}
    <text x="56" y="584" font-family="${MONO}" font-size="13" fill="${INK3}">${esc(footer ?? 'VITRINE')}</text>
  `;
}

async function compositeCard({ key, eyebrow, title, meta, footer, logo, shots, out }) {
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${BG}"/>
    ${textPanel({ eyebrow, title, meta, footer, hasLogo: !!(logo && existsSync(logo)) })}
    <line x1="${LEFT}" y1="0" x2="${LEFT}" y2="${H}" stroke="${LINE}" stroke-width="1"/>
  </svg>`;
  const base = sharp(Buffer.from(svg)).resize(W, H).jpeg({ quality: 88, mozjpeg: true });
  const composites = [];

  if (logo && existsSync(logo)) {
    try {
      const icon = await sharp(logo)
        .flatten({ background: '#ffffff' })
        .resize(220, 64, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
      composites.push({ input: icon, left: 56, top: 168 });
    } catch {
      /* skip broken logos */
    }
  }

  const rightW = W - LEFT;
  const shotList = uniqueExisting(shots).slice(0, 4);
  if (shotList.length === 1) {
    const buf = await sharp(shotList[0])
      .resize(rightW, H, { fit: 'cover', position: 'top' })
      .jpeg({ quality: 86 })
      .toBuffer();
    composites.push({ input: buf, left: LEFT, top: 0 });
  } else if (shotList.length === 2) {
    const hw = Math.floor(rightW / 2);
    for (let i = 0; i < 2; i++) {
      const buf = await sharp(shotList[i])
        .resize(hw, H, { fit: 'cover', position: 'top' })
        .jpeg({ quality: 86 })
        .toBuffer();
      composites.push({ input: buf, left: LEFT + i * hw, top: 0 });
    }
  } else if (shotList.length >= 3) {
    const gap = 8;
    const cellW = Math.floor((rightW - gap * 3) / 2);
    const cellH = Math.floor((H - gap * 3) / 2);
    for (let i = 0; i < Math.min(4, shotList.length); i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const buf = await sharp(shotList[i])
        .resize(cellW, cellH, { fit: 'cover', position: 'top' })
        .jpeg({ quality: 86 })
        .toBuffer();
      composites.push({
        input: buf,
        left: LEFT + gap + col * (cellW + gap),
        top: gap + row * (cellH + gap),
      });
    }
  }

  mkdirSync(dirname(out), { recursive: true });
  const img = composites.length ? base.composite(composites) : base;
  await img.toFile(out);
  return out;
}

function r2Rel(abs) {
  return abs.slice(filesDir.length + 1);
}

const storesJson = JSON.parse(readFileSync(join(ROOT, 'data/curation/stores.json'), 'utf8')).stores;
const homeGallery = existsSync(join(ROOT, 'data/curation/home-gallery.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data/curation/home-gallery.json'), 'utf8'))
  : [];

const counts = {
  scanned: Number(sql("SELECT value FROM meta WHERE key='scanned_total'")[0]?.value ?? 1486),
  curated: storesJson.length,
  shots: 0,
  sections: 0,
  apps: 0,
  themes: 0,
};
const shotRow = sql(
  'SELECT COUNT(*) AS n FROM screenshots WHERE is_current=1 AND IFNULL(is_placeholder,0)=0',
);
if (Array.isArray(shotRow) && shotRow[0]?.n) counts.shots = Number(shotRow[0].n);
const secRow = sql('SELECT COUNT(*) AS n FROM sections WHERE IFNULL(is_current,1)=1');
if (Array.isArray(secRow) && secRow[0]?.n) counts.sections = Number(secRow[0].n);
const appRow = sql('SELECT COUNT(*) AS n FROM apps');
if (Array.isArray(appRow) && appRow[0]?.n) counts.apps = Number(appRow[0].n);
const themeRow = sql('SELECT COUNT(*) AS n FROM themes');
if (Array.isArray(themeRow) && themeRow[0]?.n) counts.themes = Number(themeRow[0].n);

const fmt = (n) => Number(n).toLocaleString('en-US');

const written = [];
async function writeCard(rel, opts) {
  const out = join(filesDir, rel);
  await compositeCard({ ...opts, out });
  written.push({ key: rel, file: out });
}

function take(arr) {
  return arr.slice(0, Number.isFinite(limit) ? limit : arr.length);
}

// Home
const homeShots = (
  Array.isArray(homeGallery) ? homeGallery : (homeGallery.stores ?? homeGallery.domains ?? [])
)
  .map((x) => (typeof x === 'string' ? x : x.domain || x.slug))
  .filter(Boolean)
  .map(latestShot)
  .filter(Boolean)
  .slice(0, 4);
if (homeShots.length < 4) {
  for (const s of storesJson) {
    if (homeShots.length >= 4) break;
    const sh = latestShot(s.domain);
    if (sh && !homeShots.includes(sh)) homeShots.push(sh);
  }
}

console.log(`og-images curated=${counts.curated} shots=${counts.shots} out=${outDir}`);
await writeCard('og/home.jpg', {
  eyebrow: 'Library',
  title: 'Themes and apps, on the stores that run them.',
  meta: `${fmt(counts.curated)} curated stores · ${fmt(counts.shots)} real screenshots`,
  footer: 'VITRINE  ·  INDEPENDENT LIBRARY',
  shots: homeShots,
});
// public/og-default.png is the typographic fallback, kept in git.
// Catalog home uses /media/og/home.jpg (the designed card with store screenshots).

// Stores
for (const s of take(storesJson)) {
  await writeCard(`og/store/${s.domain}.jpg`, {
    eyebrow: 'Store',
    title: s.name || s.domain,
    meta: [s.category, s.country, s.domain].filter(Boolean).join('  ·  '),
    footer: s.domain.toUpperCase(),
    logo: latestIcon('store', s.domain),
    shots: [latestShot(s.domain)].filter(Boolean),
  });
}

// Apps
const apps = Array.isArray(
  sql('SELECT slug, name, app_store_category AS category FROM apps ORDER BY name'),
)
  ? sql('SELECT slug, name, app_store_category AS category FROM apps ORDER BY name')
  : [];
function appShot(slug) {
  // first store that has this app, from store_apps if possible
  const rows = sql(
    `SELECT s.domain FROM store_apps sa JOIN stores s ON s.id = sa.store_id
     JOIN apps a ON a.id = sa.app_id WHERE a.slug = '${slug.replace(/'/g, "''")}' AND s.is_curated=1
     LIMIT 8`,
  );
  if (!Array.isArray(rows)) return null;
  for (const r of rows) {
    const sh = latestShot(r.domain);
    if (sh) return sh;
  }
  return null;
}
for (const a of take(apps)) {
  await writeCard(`og/app/${a.slug}.jpg`, {
    eyebrow: 'App',
    title: a.name,
    meta: a.category || 'Shopify app',
    footer: a.slug,
    logo: latestIcon('app', a.slug),
    shots: [appShot(a.slug)].filter(Boolean),
  });
}

// Themes
const themes = Array.isArray(sql('SELECT slug, name, vendor FROM themes ORDER BY name'))
  ? sql('SELECT slug, name, vendor FROM themes ORDER BY name')
  : [];
function themeShots(slug) {
  const rows = sql(
    `SELECT s.domain FROM store_themes st JOIN stores s ON s.id = st.store_id
     JOIN themes t ON t.id = st.theme_id WHERE t.slug = '${slug.replace(/'/g, "''")}' AND s.is_curated=1
     LIMIT 8`,
  );
  const out = [];
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const sh = latestShot(r.domain);
    if (sh) out.push(sh);
    if (out.length >= 4) break;
  }
  return out;
}
for (const t of take(themes)) {
  await writeCard(`og/theme/${t.slug}.jpg`, {
    eyebrow: 'Theme',
    title: t.name,
    meta: t.vendor ? `by ${t.vendor}` : 'Shopify theme',
    footer: t.slug,
    logo: latestIcon('theme', t.slug),
    shots: themeShots(t.slug),
  });
}

// Galleries
const cats = [
  ['activewear', 'Activewear'],
  ['apparel', 'Apparel'],
  ['bags-and-accessories', 'Bags & accessories'],
  ['beauty', 'Beauty'],
  ['electronics', 'Electronics'],
  ['food-and-drink', 'Food & drink'],
  ['footwear', 'Footwear'],
  ['health-and-wellness', 'Health & wellness'],
  ['home-and-garden', 'Home & garden'],
  ['jewelry', 'Jewelry'],
  ['kids-and-baby', 'Kids & baby'],
  ['pets', 'Pets'],
  ['sports-and-outdoors', 'Sports & outdoors'],
  ['toys-and-hobbies', 'Toys & hobbies'],
];
function catShots(name) {
  const out = [];
  for (const s of storesJson) {
    if (s.category !== name) continue;
    const sh = latestShot(s.domain);
    if (sh) out.push(sh);
    if (out.length >= 4) break;
  }
  return out;
}
for (const [slug, name] of cats) {
  const n = storesJson.filter((s) => s.category === name).length;
  await writeCard(`og/gallery/${slug}.jpg`, {
    eyebrow: 'Gallery',
    title: name,
    meta: `${fmt(n)} curated stores`,
    footer: `STORES / ${slug.toUpperCase()}`,
    shots: catShots(name),
  });
}

// Compare pairs
const pairs = Array.isArray(
  sql(`SELECT c.slug, c.kind,
            COALESCE(aa.name, ta.name) AS a_name, COALESCE(aa.slug, ta.slug) AS a_slug,
            COALESCE(ab.name, tb.name) AS b_name, COALESCE(ab.slug, tb.slug) AS b_slug
     FROM comparisons c
     LEFT JOIN apps aa ON c.kind='app' AND aa.id=c.a_id
     LEFT JOIN apps ab ON c.kind='app' AND ab.id=c.b_id
     LEFT JOIN themes ta ON c.kind='theme' AND ta.id=c.a_id
     LEFT JOIN themes tb ON c.kind='theme' AND tb.id=c.b_id
     ORDER BY c.position, c.slug`),
)
  ? sql(`SELECT c.slug, c.kind,
            COALESCE(aa.name, ta.name) AS a_name, COALESCE(aa.slug, ta.slug) AS a_slug,
            COALESCE(ab.name, tb.name) AS b_name, COALESCE(ab.slug, tb.slug) AS b_slug
     FROM comparisons c
     LEFT JOIN apps aa ON c.kind='app' AND aa.id=c.a_id
     LEFT JOIN apps ab ON c.kind='app' AND ab.id=c.b_id
     LEFT JOIN themes ta ON c.kind='theme' AND ta.id=c.a_id
     LEFT JOIN themes tb ON c.kind='theme' AND tb.id=c.b_id
     ORDER BY c.position, c.slug`)
  : [];

function entityShot(kind, slug) {
  return kind === 'app' ? appShot(slug) : themeShots(slug)[0];
}
function entityLogo(kind, slug) {
  return latestIcon(kind === 'app' ? 'app' : 'theme', slug);
}

for (const p of take(pairs)) {
  await writeCard(`og/compare/${p.slug}.jpg`, {
    eyebrow: p.kind === 'theme' ? 'Theme compare' : 'App compare',
    title: `${p.a_name ?? p.a_slug} vs ${p.b_name ?? p.b_slug}`,
    meta: 'Side by side on real stores',
    footer: p.slug,
    logo: entityLogo(p.kind, p.a_slug),
    shots: [entityShot(p.kind, p.a_slug), entityShot(p.kind, p.b_slug)].filter(Boolean),
  });
}
await writeCard('og/compare.jpg', {
  eyebrow: 'Compare',
  title: 'Apps and themes, side by side.',
  meta: `${fmt(pairs.length)} curated comparisons on real stores`,
  footer: 'VITRINE  ·  COMPARE',
  shots: pairs
    .slice(0, 8)
    .map((p) => entityShot(p.kind, p.a_slug))
    .filter(Boolean)
    .slice(0, 4),
});

writeFileSync(join(outDir, 'r2-manifest.json'), JSON.stringify(written));
console.log(`done files=${written.length}`);

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
  const cwd = ROOT;
  const sleep = (ms) => spawnSync('sleep', [String(ms / 1000)]);
  for (let i = 0; i < written.length; i += CHUNK) {
    const part = written.slice(i, i + CHUNK);
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
          'image/jpeg',
          '--cc',
          'public, max-age=86400',
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
        console.log(`uploaded ${Math.min(i + CHUNK, written.length)}/${written.length}`);
      } else {
        const rate = /429|Too Many Requests/i.test(out);
        const wait = rate ? Math.min(180, 20 * 2 ** (attempt - 1)) : Math.min(30, 5 * attempt);
        console.error(`upload FAIL attempt ${attempt} (retry in ${wait}s)`, out.slice(-300));
        if (attempt >= 10) process.exit(1);
        sleep(wait * 1000);
      }
    }
    sleep(2000);
  }
}
