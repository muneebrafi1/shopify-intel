/// <reference types="node" />
/**
 * npm run crawl:export-rules
 *
 * Writes .data/crawl/rules.json: the compact rule set the Worker's scheduled crawler uses
 * (src/server/crawl/html-detect.ts), exported from the StorePeek signature database in
 * STOREPEEK_DIR. Upload it to the preview bucket (never committed):
 *   npx wrangler r2 object put vitrine-preview-media/crawl/rules.json --remote \
 *     --file .data/crawl/rules.json --content-type application/json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CrawlRules } from '../../src/server/crawl/html-detect.ts';
import { STOREPEEK_DIR } from './collect.ts';
import { ROOT } from '../capture/paths.ts';

interface Sig {
  slug: string;
  name?: string;
  signals?: {
    script_domains?: string[];
    script_paths?: string[];
    app_handles?: string[];
    handle_aliases?: string[];
  };
}
const sig = JSON.parse(readFileSync(join(STOREPEEK_DIR, 'src/data/signatures.json'), 'utf8')) as {
  version: number | string;
  apps: Sig[];
  pixels: Array<{ name: string }>;
};
const themes = JSON.parse(readFileSync(join(STOREPEEK_DIR, 'src/data/themes.json'), 'utf8')) as {
  themes: Record<string, { name: string }>;
};
// Trackers listed both as pixels and as apps (Clarity, Triple Whale…) are pixels, as in the
// signature engine: drop their app twins.
const normName = (x?: string) => (x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pixelKeys = sig.pixels.map((p) => normName(p.name)).filter((k) => k.length >= 6);
const isPixelTwin = (a: Sig) => {
  const n = normName(a.name);
  return !!n && pixelKeys.some((k) => n.startsWith(k) || k.startsWith(n));
};
const nonEmpty = (a?: string[]) => (a && a.length ? a : undefined);
const rules: CrawlRules = {
  version: `storepeek-signatures-v${sig.version}-html`,
  apps: Object.fromEntries(
    sig.apps
      .filter((a) => !isPixelTwin(a))
      .map((a) => [
        a.slug,
        {
          d: nonEmpty(a.signals?.script_domains),
          p: nonEmpty(a.signals?.script_paths),
          h: nonEmpty(a.signals?.app_handles),
          a: nonEmpty(a.signals?.handle_aliases),
        },
      ]),
  ),
  themes: Object.fromEntries(Object.entries(themes.themes).map(([id, t]) => [id, t.name])),
};
const out = join(ROOT, '.data/crawl/rules.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(rules));
console.log(
  `Wrote ${Object.keys(rules.apps).length} app rules, ${Object.keys(rules.themes).length} themes → .data/crawl/rules.json`,
);
