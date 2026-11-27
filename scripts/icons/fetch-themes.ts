/**
 * Official Theme Store hero thumbnails for our theme marks (listing reference only).
 * Reads each theme's public Theme Store page (official_url in data/seed/themes.json),
 * respects robots.txt with the VitrineBot UA, and writes a top-square WebP into
 * .data/icons/themes/ plus a `themes` entry in data/curation/icons.json.
 *
 *   node scripts/icons/fetch-themes.ts [--only dawn,prestige] [--refetch]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { robotsFor, identify } from '../crawl/robots.ts';

const ROOT = join(import.meta.dirname, '../..');
const OUT = join(ROOT, '.data/icons/themes');
const MANIFEST = join(ROOT, 'data/curation/icons.json');
const SEED = join(ROOT, 'data/seed/themes.json');
const UA = identify(
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
);

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    refetch: { type: 'boolean', default: false },
  },
});
const only = values.only ? new Set(values.only.split(',')) : null;
const refetch = Boolean(values.refetch);

type ThemeEntry = { from: string; key: string; w?: number; h?: number };
type Manifest = {
  apps: Record<string, unknown>;
  stores: Record<string, unknown>;
  themes?: Record<string, ThemeEntry>;
  missing: { apps: string[]; stores: string[]; themes?: string[] };
};
const manifest: Manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : { apps: {}, stores: {}, themes: {}, missing: { apps: [], stores: [], themes: [] } };
manifest.themes ??= {};
manifest.missing ??= { apps: [], stores: [], themes: [] };
manifest.missing.themes ??= [];

type SeedTheme = { slug: string; name: string; official_url: string | null };
const seed = JSON.parse(readFileSync(SEED, 'utf8')) as SeedTheme[];

/** Desktop hero on a Theme Store page: the 1200×800 (or width=2400) demo thumbnail. */
export function heroThumbUrl(html: string): string | null {
  const wide = html.match(
    /src="(https:\/\/cdn\.shopify\.com\/theme-store\/[a-z0-9]+\.(?:jpg|jpeg|png|webp))\?width=2400"/i,
  );
  if (wide) return `${wide[1]}?width=800&quality=80`;
  const sized = html.match(
    /src="(https:\/\/cdn\.shopify\.com\/theme-store\/[a-z0-9]+\.(?:jpg|jpeg|png|webp))(?:\?[^"]*)?"[^>]*(?:width="1200"[^>]*height="800"|height="800"[^>]*width="1200")/i,
  );
  if (sized) return `${sized[1].split('?')[0]}?width=800&quality=80`;
  const any = html.match(
    /src="(https:\/\/cdn\.shopify\.com\/theme-store\/[a-z0-9]+\.(?:jpg|jpeg|png|webp))(?:\?width=(?!20\b)[^"]*)?"/i,
  );
  return any ? `${any[1].split('?')[0]}?width=800&quality=80` : null;
}

async function get(url: string): Promise<Response> {
  let delay = 2500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,image/*,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status !== 429 && res.status !== 503 && res.status !== 403) return res;
      const ra = res.headers.get('retry-after');
      const wait = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : delay;
      await new Promise((r) => setTimeout(r, Math.min(wait, 25_000)));
      delay = Math.min(delay * 2, 20_000);
      lastErr = res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 20_000);
    }
  }
  if (lastErr instanceof Response) return lastErr;
  throw lastErr;
}

async function toMark(buf: Buffer): Promise<{ data: Buffer; w: number; h: number } | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 64) return null;
    const side = Math.min(meta.width, meta.height);
    const left = Math.max(0, Math.floor((meta.width - side) / 2));
    const data = await sharp(buf)
      .extract({ left, top: 0, width: side, height: side })
      .resize(256, 256, { fit: 'cover', position: 'top' })
      .webp({ quality: 82 })
      .toBuffer();
    return { data, w: 256, h: 256 };
  } catch {
    return null;
  }
}

function writeIcon(slug: string, data: Buffer): string {
  const hash = createHash('sha1').update(data).digest('hex').slice(0, 8);
  mkdirSync(OUT, { recursive: true });
  const name = `${slug}.${hash}.webp`;
  writeFileSync(join(OUT, name), data);
  return `icons/themes/${name}`;
}

const robots = await robotsFor('themes.shopify.com');
const themes = seed.filter((t) => t.official_url && (!only || only.has(t.slug)));
console.log(`themes: ${themes.length} to fetch (${seed.length} in seed; refetch=${refetch})`);

let ok = 0;
const missing: string[] = [];
for (const [i, theme] of themes.entries()) {
  if (!refetch && manifest.themes[theme.slug]) {
    ok++;
    continue;
  }
  const path = new URL(theme.official_url!).pathname;
  if (!robots.allows(path)) {
    console.log(`  skip ${theme.slug}: robots disallows ${path}`);
    missing.push(theme.slug);
    continue;
  }
  try {
    const page = await get(theme.official_url!);
    if (!page.ok) {
      console.log(`  fail ${theme.slug}: theme page HTTP ${page.status}`);
      missing.push(theme.slug);
    } else {
      const url = heroThumbUrl(await page.text());
      if (!url) {
        console.log(`  fail ${theme.slug}: no hero thumbnail on the Theme Store page`);
        missing.push(theme.slug);
      } else {
        const img = await get(url);
        if (!img.ok) {
          console.log(`  fail ${theme.slug}: thumbnail HTTP ${img.status}`);
          missing.push(theme.slug);
        } else {
          const mark = await toMark(Buffer.from(await img.arrayBuffer()));
          if (!mark) {
            console.log(`  fail ${theme.slug}: thumbnail could not be cropped`);
            missing.push(theme.slug);
          } else {
            const key = writeIcon(theme.slug, mark.data);
            manifest.themes[theme.slug] = { from: url.split('?')[0]!, key, w: mark.w, h: mark.h };
            ok++;
            console.log(`  ok   ${theme.slug}: ${key}`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`  fail ${theme.slug}: ${err instanceof Error ? err.message : err}`);
    missing.push(theme.slug);
  }
  if (i < themes.length - 1) await new Promise((r) => setTimeout(r, 3000));
}

manifest.missing.themes = [
  ...new Set([
    ...missing,
    ...seed.filter((t) => t.official_url && !manifest.themes[t.slug]).map((t) => t.slug),
  ]),
].sort();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(
  `done: ${ok} theme marks, ${manifest.missing.themes.length} missing; manifest has ${Object.keys(manifest.themes).length} themes`,
);
