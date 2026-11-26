/// <reference types="node" />
/**
 * npm run crawl:themes [-- --only prestige,dawn]
 *
 * Reads each theme's public Shopify Theme Store page (the official_url in data/seed/themes.json)
 * and writes data/curation/theme-store.json: its presets, its published feature list, the
 * current version and the review summary, each with the page URL and the date checked. These
 * are Shopify's own published facts about the theme; the seed turns them into theme_presets,
 * theme_features and the Theme Store fields of `themes`. One request per theme, spaced out.
 *
 * The Theme Store publishes no per-theme style or industry tags, so theme_tags stays empty
 * (we do not invent them).
 */
import { identify } from './robots.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from '../capture/paths.ts';

export interface ThemeStoreFacts {
  url: string;
  checked_at: string;
  presets: string[];
  features: Array<{ group: string; items: string[] }>;
  version: string | null;
  reviews: { positive_pct: number; count: number } | null;
}

const OUT = join(ROOT, 'data/curation/theme-store.json');
const UA = identify(
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
);

/** Visible text of the page as " | "-separated tokens (scripts, styles and SVGs removed). */
export function pageTokens(html: string): string[] {
  const decode = (t: string) =>
    t
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<[^>]*>/g, '\u0000'),
  )
    .split('\u0000')
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t && !/[{}[\]]|:not\(|tw-/.test(t));
}

/** Feature group headings the Theme Store uses. */
const GROUPS = new Set([
  'Cart and checkout',
  'Marketing and conversion',
  'Merchandising',
  'Product discovery',
]);

export function parseThemeStorePage(
  html: string,
  themeName: string,
): Omit<ThemeStoreFacts, 'url' | 'checked_at'> {
  const t = pageTokens(html);
  // Presets: "Presets" · "<Theme> comes with N ready-made designs…" · N names.
  let presets: string[] = [];
  const p = t.findIndex((x, i) => x === 'Presets' && /ready-made designs?/.test(t[i + 1] ?? ''));
  if (p >= 0) {
    const n = Number(/with (\d+) ready-made/.exec(t[p + 1] ?? '')?.[1] ?? '1');
    presets = t.slice(p + 2, p + 2 + n).filter((x) => x.length <= 40);
  } else {
    presets = [themeName];
  }
  // Features: after "Features" in WHAT'S INCLUDED; the list is rendered twice, keep the first.
  const features: ThemeStoreFacts['features'] = [];
  const f = t.findIndex((x, i) => x === 'Features' && /WHAT.S INCLUDED/i.test(t[i - 1] ?? ''));
  if (f >= 0) {
    const seen = new Set<string>();
    for (let i = f + 1; i < t.length && t[i] !== 'Presets'; i++) {
      const tok = t[i]!;
      if (GROUPS.has(tok)) {
        if (seen.has(tok)) break; // second copy of the list
        seen.add(tok);
        features.push({ group: tok, items: [] });
      } else if (features.length && tok !== 'Shopify Plus' && tok.length <= 60) {
        const g = features.at(-1)!;
        if (!g.items.includes(tok)) g.items.push(tok);
      }
    }
  }
  const versionTok = t.find((x) => /^Version \d+(\.\d+)*$/.test(x));
  const pct = t.find((x) => /^\d{1,3}% positive$/.test(x));
  const count = t.find((x) => /^[\d,]+ reviews?( for all presets)?$/.test(x));
  return {
    presets,
    features,
    version: versionTok ? versionTok.replace('Version ', '') : null,
    reviews:
      pct && count
        ? {
            positive_pct: Number(pct.replace(/%.*/, '')),
            count: Number(count.replace(/[^\d]/g, '')),
          }
        : null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { only: { type: 'string' } } });
  const only = values.only ? new Set(values.only.split(',')) : null;
  const themes = JSON.parse(readFileSync(join(ROOT, 'data/seed/themes.json'), 'utf8')) as Array<{
    slug: string;
    name: string;
    official_url: string | null;
    marketplace: string | null;
  }>;
  const out: { _note: string; themes: Record<string, ThemeStoreFacts> } = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : { _note: '', themes: {} };
  out._note =
    "Shopify Theme Store facts per theme, read from each theme's public Theme Store page by scripts/crawl/theme-store.ts (npm run crawl:themes). Presets, the published feature list, the current version and the review summary, with the page URL and the date checked. Re-run to refresh; never edit by hand.";
  for (const th of themes) {
    if (only && !only.has(th.slug)) continue;
    if (!th.official_url?.startsWith('https://themes.shopify.com/')) {
      console.log(`  skip ${th.slug}: not on the Theme Store`);
      continue;
    }
    try {
      const res = await fetch(th.official_url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const facts = parseThemeStorePage(await res.text(), th.name);
      out.themes[th.slug] = {
        url: th.official_url,
        checked_at: new Date().toISOString(),
        ...facts,
      };
      console.log(
        `  ok   ${th.slug}: ${facts.presets.length} presets, ${facts.features.reduce((n, g) => n + g.items.length, 0)} features, v${facts.version ?? '?'}, ${facts.reviews ? `${facts.reviews.positive_pct}% of ${facts.reviews.count}` : 'no reviews'}`,
      );
    } catch (e) {
      console.log(`  FAIL ${th.slug}: ${String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  out.themes = Object.fromEntries(
    Object.entries(out.themes).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log('Wrote data/curation/theme-store.json');
}
