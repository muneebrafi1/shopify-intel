/// <reference types="node" />
/**
 * npm run seed:import-apps
 *
 * Writes data/seed/apps-storepeek.json: an app record for every detection rule in Muneeb's
 * StorePeek signature database (STOREPEEK_DIR/src/data/signatures.json) that
 *   1. was actually detected on at least one scanned store (detections-930.json or the latest
 *      local crawl in .data/crawl/scans.json), and
 *   2. has a cached App Store listing in StorePeek's own crawl (site/data/appstore.json).
 * Apps already in apps.json / apps-extra.json are left alone. Only real data: undetected apps
 * and apps without a listing are skipped, so every new app page has real usage behind it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const SP = process.env.STOREPEEK_DIR ?? '/workspace/extensions/storepeek';
const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

interface Sig {
  slug: string;
  name: string;
  vendor?: string;
  category: string;
  listing?: string;
}
interface Listing {
  handle: string;
  url?: string;
  checked_on?: string;
  name?: string;
  developer?: string;
  brand?: string;
  rating?: number;
  reviews?: number;
  icon?: string;
  tagline?: string;
  launched?: string;
  bfs?: boolean;
  category?: string;
  free_plan?: boolean;
  from_price?: number | null;
  trial_days?: number | null;
  languages?: string[];
  features?: string[];
  works_with?: string[];
  plans?: Array<{
    name: string;
    price: string;
    period?: string | null;
    trial_days?: number | null;
    features?: string[];
  }>;
  unavailable?: boolean;
  error?: string;
}

const sigs = read<{ apps: Sig[] }>(join(SP, 'src/data/signatures.json')).apps;
const listings = read<Record<string, Listing>>(join(SP, 'site/data/appstore.json'));
const existing = new Set(
  ['data/seed/apps.json', 'data/seed/apps-extra.json'].flatMap((f) =>
    read<Array<{ slug: string }>>(join(ROOT, f)).map((a) => a.slug),
  ),
);

// Usage: the 930-store baseline count (the seed cross-checks it), plus slugs seen only by the
// latest local crawl (count 0 here; the crawl ingest adds those stores).
const detections = read<Array<{ apps: string[] }>>(join(ROOT, 'data/seed/detections-930.json'));
const baseline = new Map<string, number>();
for (const d of detections) for (const s of d.apps) baseline.set(s, (baseline.get(s) ?? 0) + 1);
const crawled = new Set<string>();
const scansFile = join(ROOT, '.data/crawl/scans.json');
if (existsSync(scansFile))
  for (const o of read<Array<{ scan: { platform: string; apps?: Array<{ slug: string }> } }>>(
    scansFile,
  ))
    if (o.scan.platform === 'shopify') for (const a of o.scan.apps ?? []) crawled.add(a.slug);

const handleOf = (url?: string) =>
  url && /^https:\/\/apps\.shopify\.com\//.test(url)
    ? (url
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
        .split('/')
        .pop() ?? null)
    : null;

const out: unknown[] = [];
const skipped: Record<string, number> = {};
const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
for (const s of sigs) {
  if (existing.has(s.slug)) continue;
  const stores = baseline.get(s.slug) ?? 0;
  if (stores === 0 && !crawled.has(s.slug)) {
    skip('not detected');
    continue;
  }
  const handle = handleOf(s.listing);
  const l = handle ? listings[handle] : undefined;
  if (!handle || !l || l.unavailable || l.error || !l.name) {
    skip('no listing data');
    continue;
  }
  const plans = (l.plans ?? []).map((p) => ({
    name: p.name,
    price: p.price,
    period: p.period ?? null,
    trial_days: p.trial_days ?? null,
    features: p.features ?? [],
  }));
  out.push({
    slug: s.slug,
    app_store_handle: handle,
    name: l.name.trim(),
    developer: l.developer ?? l.brand ?? s.vendor ?? null,
    category: s.category,
    tagline: l.tagline ?? null,
    rating: l.rating ?? null,
    reviews: l.reviews ?? null,
    icon_url: l.icon ?? null,
    app_store_url: l.url ?? `https://apps.shopify.com/${handle}`,
    launched: l.launched ?? null,
    built_for_shopify: l.bfs ?? null,
    app_store_category: l.category ?? null,
    plans: plans.length ? plans : null,
    free_plan: l.free_plan ?? null,
    from_price: l.from_price ?? null,
    trial_days: l.trial_days ?? null,
    features: l.features ?? null,
    works_with: l.works_with ?? null,
    languages: l.languages ?? null,
    app_store_checked_on: l.checked_on ?? null,
    scan: { stores },
    affiliate: null,
  });
}
writeFileSync(join(ROOT, 'data/seed/apps-storepeek.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${out.length} apps to data/seed/apps-storepeek.json; skipped`, skipped);
