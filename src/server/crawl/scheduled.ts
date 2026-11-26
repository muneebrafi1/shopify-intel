/**
 * The Worker's scheduled crawler (Cron Trigger, see wrangler.jsonc `triggers`): every run scans
 * ONE active store's home page, round-robin by store id, and records what changed through
 * ingestScan() (theme switches and version bumps, newly seen apps; apps are never closed).
 *
 * Free-plan budget: one store per run keeps CPU well under 10 ms (detection ~2 ms), ~12 D1
 * queries and ~25 rows written per run. At one run every 10 minutes the 930 stores are revisited
 * about weekly (~4k rows written a day). Derived tables (app_stats…) are NOT rebuilt here: a full
 * rebuild rewrites ~60k rows; they are refreshed by the box-side sync instead.
 *
 * Polite: honours robots.txt for our token, sends an identifying user agent, one request per
 * store per week, stops on bot checks. Opted-out and tombstoned stores are refused by ingestScan.
 */
import { parseRobots, ROBOTS_TOKEN } from '../../lib/robots.ts';
import { d1Db } from '../db/d1.ts';
import type { Db } from '../db/types.ts';
import { ingestScan } from '../repo/scans.ts';
import {
  compileRules,
  detectFromHtml,
  type CompiledRules,
  type CrawlRules,
} from './html-detect.ts';

export const RULES_KEY = 'crawl/rules.json';
const CURSOR_KEY = 'crawl_cursor';

const botUa = (site: string) =>
  `Mozilla/5.0 (compatible; ${ROBOTS_TOKEN}/1.0; +${new URL('/methodology#crawler', site).href})`;

let cached: CompiledRules | null = null;
async function loadRules(media: R2Bucket): Promise<CompiledRules | null> {
  if (cached) return cached;
  const obj = await media.get(RULES_KEY);
  if (!obj) return null;
  cached = compileRules(JSON.parse(await obj.text()) as CrawlRules);
  return cached;
}

export async function nextStore(
  db: Db,
): Promise<{ id: number; domain: string; url: string | null } | null> {
  const cur = await db.first<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    CURSOR_KEY,
  ]);
  const after = Number(cur?.value ?? 0) || 0;
  const pick = (sql: string, p: number[]) =>
    db.first<{ id: number; domain: string; url: string | null }>(sql, p);
  const sql = `SELECT id, domain, url FROM stores WHERE status = 'active' AND id > ? ORDER BY id LIMIT 1`;
  return (await pick(sql, [after])) ?? (after > 0 ? await pick(sql, [0]) : null);
}

export type CrawlOutcome =
  | { status: 'no-rules' | 'no-stores' }
  | { status: 'skipped'; domain: string; reason: string }
  | { status: 'scanned'; domain: string; result: string; theme?: string; apps_added?: number };

export async function crawlNext(
  env: { DB: D1Database; MEDIA: R2Bucket },
  site: string,
  fetcher: typeof fetch = fetch,
): Promise<CrawlOutcome> {
  const db = d1Db(env.DB);
  const rules = await loadRules(env.MEDIA);
  if (!rules) return { status: 'no-rules' };
  const store = await nextStore(db);
  if (!store) return { status: 'no-stores' };
  // Advance first, so a store that keeps failing never blocks the rotation.
  await db.run(
    `INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [CURSOR_KEY, String(store.id), new Date().toISOString()],
  );
  const ua = botUa(site);
  const home = store.url ?? `https://${store.domain}/`;
  const skip = (reason: string): CrawlOutcome => ({
    status: 'skipped',
    domain: store.domain,
    reason,
  });
  try {
    const robotsRes = await fetcher(new URL('/robots.txt', home), {
      headers: { 'User-Agent': ua },
      signal: AbortSignal.timeout(10_000),
    });
    if (robotsRes.status >= 500) return skip(`robots.txt ${robotsRes.status}`);
    if (robotsRes.ok) {
      const robots = parseRobots(await robotsRes.text());
      if (!robots.allows(new URL(home).pathname || '/')) return skip('robots.txt disallows');
    }
    const res = await fetcher(home, {
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return skip(`HTTP ${res.status}`);
    const html = await res.text();
    const d = detectFromHtml(html, rules);
    if (d.platform === 'challenge') return skip('bot check');
    const result = await ingestScan(db, {
      domain: store.domain,
      url: res.url || home,
      scanned_at: new Date().toISOString(),
      source: 'vitrine-cron',
      rules_version: rules.version,
      http_status: res.status,
      platform: d.platform,
      site_name: d.site_name,
      currency: d.currency,
      theme: d.theme,
      apps: d.apps,
      pixels: [],
    });
    return result.status === 'ingested'
      ? {
          status: 'scanned',
          domain: store.domain,
          result: result.status,
          theme: result.theme,
          apps_added: result.apps_added,
        }
      : { status: 'scanned', domain: store.domain, result: result.status };
  } catch (e) {
    return skip(String(e).slice(0, 200));
  }
}
