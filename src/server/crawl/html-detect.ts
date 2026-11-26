/**
 * Home-page detection from raw HTML, for the Worker's scheduled crawler (no browser).
 *
 * Deliberately narrower than the local Playwright crawler (scripts/crawl/collect.ts): only
 * signals that are in the server-rendered HTML and name one app precisely:
 *  - app-block comments (`BEGIN app block: shopify://apps/<handle>/blocks/…`), exact handle;
 *  - theme app-extension asset URLs (`cdn.shopify.com/extensions/<id>/<handle>-<n>/…`), exact id;
 *  - script hosts owned by exactly one rule, and long, specific script paths.
 * Apps it misses are not "removed" (ingestScan never closes apps), so a narrower detector only
 * means fewer additions, never false removals. The theme comes from the `Shopify.theme` object
 * Shopify prints on every storefront.
 *
 * The rules are a compact export of the signature database (scripts/crawl/export-rules.ts),
 * kept in R2 at `crawl/rules.json`, never in this repo.
 */

export interface CrawlRules {
  version: string;
  /** slug → signals */
  apps: Record<string, { d?: string[]; p?: string[]; h?: string[]; a?: string[] }>;
  /** theme_store_id → official theme name */
  themes: Record<string, string>;
}

export interface CompiledRules {
  version: string;
  hosts: Map<string, string>;
  /** One alternation over every specific script path; `pathSlug` maps a hit back. */
  pathRx: RegExp | null;
  pathSlug: Map<string, string>;
  appHandles: Map<string, string>;
  extIds: Map<string, string[]>;
  themes: Record<string, string>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Extension ids too generic to name one app (mirrors the signature engine's list). */
const GENERIC = new Set([
  'productoptions',
  'options',
  'reviews',
  'bundle',
  'bundles',
  'upsell',
  'cart',
  'popup',
  'popups',
  'currency',
  'affiliate',
  'subscription',
  'subscriptions',
  'search',
  'loyalty',
  'rewards',
  'wishlist',
  'tracking',
  'theme',
  'app',
  'apps',
  'widget',
  'widgets',
  'blocks',
]);

export function compileRules(r: CrawlRules): CompiledRules {
  const owners = new Map<string, Set<string>>();
  for (const [slug, s] of Object.entries(r.apps))
    for (const d of s.d ?? []) {
      const k = d.toLowerCase();
      owners.set(k, (owners.get(k) ?? new Set()).add(slug));
    }
  const hosts = new Map<string, string>();
  for (const [d, set] of owners) if (set.size === 1) hosts.set(d, [...set][0]!);
  const pathSlug = new Map<string, string>();
  const appHandles = new Map<string, string>();
  const extIds = new Map<string, string[]>();
  for (const [slug, s] of Object.entries(r.apps)) {
    for (const p of s.p ?? []) if (p.length >= 10 && !pathSlug.has(p)) pathSlug.set(p, slug);
    for (const h of s.h ?? []) appHandles.set(h.toLowerCase(), slug);
    for (const id of [slug, ...(s.a ?? [])].map(norm))
      if (id.length >= 4 && !GENERIC.has(id)) extIds.set(id, [...(extIds.get(id) ?? []), slug]);
  }
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathRx = pathSlug.size ? new RegExp([...pathSlug.keys()].map(esc).join('|'), 'g') : null;
  return { version: r.version, hosts, pathRx, pathSlug, appHandles, extIds, themes: r.themes };
}

export interface HtmlScan {
  platform: 'shopify' | 'not-shopify' | 'challenge';
  theme: {
    name: string;
    raw_name: string | null;
    version: string | null;
    theme_store_id: number | null;
    is_custom: boolean;
  } | null;
  apps: Array<{ slug: string; confidence: 'high' }>;
  currency: string | null;
  site_name: string | null;
}

const hostOf = (u: string): string | null => {
  const m = /^(?:https?:)?\/\/([^/?#:]+)/i.exec(u);
  return m ? m[1]!.toLowerCase() : null;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export function detectFromHtml(html: string, rules: CompiledRules): HtmlScan {
  const head = html.slice(0, 4000);
  if (
    /<title>\s*(Verifying your connection|Just a moment|Access denied)/i.test(head) ||
    /cf-challenge|captcha/i.test(head)
  )
    return { platform: 'challenge', theme: null, apps: [], currency: null, site_name: null };
  const isShopify = /Shopify\.shop\s*=|cdn\.shopify\.com|\/cdn\/shop\//.test(html);
  if (!isShopify)
    return { platform: 'not-shopify', theme: null, apps: [], currency: null, site_name: null };

  // One pass collects every URL and app-block handle.
  const urls: string[] = [];
  const blockHandles = new Set<string>();
  const rx =
    /<(?:script|link)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']{4,500})["']|BEGIN app (?:block|embed): shopify:\/\/apps\/([a-z0-9][a-z0-9-]{1,80})\/blocks\//gi;
  for (let m = rx.exec(html); m; m = rx.exec(html)) {
    if (m[1]) urls.push(decode(m[1]));
    else if (m[2]) blockHandles.add(m[2].toLowerCase());
  }

  const found = new Set<string>();
  for (const h of blockHandles) {
    const slug = rules.appHandles.get(h);
    if (slug) found.add(slug);
  }
  const extRx = /cdn\.shopify\.com\/extensions\/[^/]+\/([a-z0-9][a-z0-9_-]{2,60})\//i;
  for (const u of urls) {
    const ext = extRx.exec(u);
    if (ext) {
      const slugs = rules.extIds.get(norm(ext[1]!.replace(/-\d+$/, '')));
      if (slugs?.length === 1) found.add(slugs[0]!);
    }
    const host = hostOf(u);
    if (host) {
      for (
        let h: string | null = host;
        h && h.includes('.');
        h = h.slice(h.indexOf('.') + 1) || null
      ) {
        const slug = rules.hosts.get(h);
        if (slug) {
          found.add(slug);
          break;
        }
      }
    }
    if (rules.pathRx) {
      rules.pathRx.lastIndex = 0;
      for (let m = rules.pathRx.exec(u); m; m = rules.pathRx.exec(u)) {
        const slug = rules.pathSlug.get(m[0]);
        if (slug) found.add(slug);
      }
    }
  }

  // Theme: Shopify.theme = {"name":…,"schema_name":…,"schema_version":…,"theme_store_id":…}
  let theme: HtmlScan['theme'] = null;
  const tm = /Shopify\.theme\s*=\s*(\{[^;]{0,2000}?\})\s*;/.exec(html);
  if (tm) {
    try {
      const t = JSON.parse(tm[1]!) as {
        name?: unknown;
        schema_name?: unknown;
        schema_version?: unknown;
        theme_store_id?: unknown;
      };
      const storeId = typeof t.theme_store_id === 'number' ? t.theme_store_id : null;
      const schema = typeof t.schema_name === 'string' && t.schema_name ? t.schema_name : null;
      const label = typeof t.name === 'string' && t.name ? t.name.slice(0, 200) : null;
      const official = storeId !== null ? (rules.themes[String(storeId)] ?? null) : null;
      const name = official ?? schema;
      if (name)
        theme = {
          name: name.slice(0, 120),
          raw_name: label,
          version:
            typeof t.schema_version === 'string' ? t.schema_version.slice(0, 40) || null : null,
          theme_store_id: storeId && storeId > 0 ? storeId : null,
          is_custom: !official && storeId === null,
        };
    } catch {
      theme = null;
    }
  }
  const cur = /Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/.exec(html);
  const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,120})["']/i.exec(
    html,
  );
  return {
    platform: 'shopify',
    theme,
    apps: [...found].sort().map((slug) => ({ slug, confidence: 'high' as const })),
    currency: cur ? cur[1]! : null,
    site_name: og ? decode(og[1]!).trim() : null,
  };
}
