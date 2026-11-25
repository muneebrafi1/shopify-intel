/// <reference types="node" />
/**
 * One home-page crawl in a real browser → a ScanInput (src/server/repo/scans.ts).
 *
 * Detection reuses the StorePeek engine and signature database (Muneeb's own extension,
 * `src/lib/match.js` + `src/data/*.json`), loaded from STOREPEEK_DIR (default
 * /workspace/extensions/storepeek). Nothing of it is copied into this repo. The collector below
 * gathers the same signals as the extension's collectors: window.Shopify, probed globals,
 * script/link/resource URLs, probed DOM selectors, app-embed and app-block handles.
 *
 * Polite: one page per store, a real browser user agent, no logins, no forms, no bypassing of
 * bot checks (a challenge page is reported as such and nothing is ingested).
 */
import type { Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ScanInput } from '../../src/server/repo/scans.ts';

export const STOREPEEK_DIR = process.env.STOREPEEK_DIR ?? '/workspace/extensions/storepeek';

interface Engine {
  analyze: (raw: unknown, db: unknown, themes: unknown, premium: unknown) => EngineResult;
  probes: { globalsToProbe: string[]; selectorsToProbe: string[] };
  db: unknown;
  themes: unknown;
  premium: unknown;
  version: string;
}
interface EngineResult {
  platform: 'shopify' | 'shopify-headless' | 'not-shopify';
  shop: { currency: string | null } | null;
  theme: {
    notExposed?: boolean;
    displayName?: string;
    officialName?: string | null;
    baseName?: string | null;
    baseVersion?: string | null;
    merchantName?: string | null;
    themeStoreId?: number | null;
    isCustom?: boolean;
    customized?: boolean;
  } | null;
  apps: Array<{ slug: string; confidence: 'high' | 'medium' | 'low' }>;
  pixels: Array<{ slug: string }>;
}

/** StorePeek pixel slugs → src/lib/taxonomy.ts PIXELS keys, where they differ. */
const PIXEL_ALIASES: Record<string, string> = { 'snap-pixel': 'snapchat' };

export async function loadEngine(): Promise<Engine> {
  const json = (f: string) => JSON.parse(readFileSync(join(STOREPEEK_DIR, 'src/data', f), 'utf8'));
  const mod = (await import(pathToFileURL(join(STOREPEEK_DIR, 'src/lib/match.js')).href)) as {
    analyze: Engine['analyze'];
    probesFrom: (db: unknown) => Engine['probes'];
  };
  const db = json('signatures.json') as { version: number };
  return {
    analyze: mod.analyze,
    probes: mod.probesFrom(db),
    db,
    themes: json('themes.json'),
    premium: json('premium-themes.json'),
    version: `storepeek-signatures-v${db.version}`,
  };
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function crawlStore(
  browser: Browser,
  engine: Engine,
  domain: string,
): Promise<{ scan: ScanInput; country: string | null; note: string | null }> {
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    const res = await page.goto(`https://${domain}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
    await page.waitForTimeout(1500);
    const { globalsToProbe, selectorsToProbe } = engine.probes;
    const raw = await page.evaluate(
      ({ globalsToProbe, selectorsToProbe }) => {
        const w = window as unknown as Record<string, any>;
        const S = w.Shopify;
        const main: Record<string, any> = { isShopify: false, shopify: null, globals: [] };
        if (S && typeof S === 'object') {
          main.isShopify = true;
          main.shopify = {
            shop: typeof S.shop === 'string' ? S.shop : null,
            currency: S.currency?.active ?? null,
            locale: typeof S.locale === 'string' ? S.locale : null,
            country: typeof S.country === 'string' ? S.country : null,
            theme:
              S.theme && typeof S.theme === 'object'
                ? {
                    name: typeof S.theme.name === 'string' ? S.theme.name : null,
                    id: typeof S.theme.id === 'number' ? S.theme.id : null,
                    theme_store_id:
                      typeof S.theme.theme_store_id === 'number' ? S.theme.theme_store_id : null,
                    role: typeof S.theme.role === 'string' ? S.theme.role : null,
                    schema_name:
                      typeof S.theme.schema_name === 'string' ? S.theme.schema_name : null,
                    schema_version:
                      typeof S.theme.schema_version === 'string' ? S.theme.schema_version : null,
                  }
                : null,
          };
        }
        for (const g of globalsToProbe) {
          try {
            let ref: any = window;
            let found = true;
            for (const part of g.split('.')) {
              if (ref != null && part in Object(ref)) ref = ref[part];
              else {
                found = false;
                break;
              }
            }
            if (found && ref !== undefined) main.globals.push(g);
          } catch {
            /* getter threw */
          }
        }
        const attr = (sel: string, a: string) =>
          Array.from(document.querySelectorAll(sel))
            .map((e) => (e.getAttribute(a) ?? '').slice(0, 500))
            .filter(Boolean);
        const resources = performance.getEntriesByType('resource').map((e) => e.name.slice(0, 500));
        const scripts = attr('script[src]', 'src');
        const links = attr('link[href]', 'href');
        const selectorHits = selectorsToProbe.filter((sel) => {
          try {
            return !!document.querySelector(sel);
          } catch {
            return false;
          }
        });
        const everything = `${scripts.join('\n')}\n${links.join('\n')}`;
        const handles = new Set<string>();
        const rx = /cdn\.shopify\.com\/extensions\/[^/]+\/([a-z0-9][a-z0-9_-]{2,60})\//gi;
        for (const u of [...resources, ...scripts, ...links]) {
          let m: RegExpExecArray | null;
          while ((m = rx.exec(u)) !== null) handles.add(m[1]!.toLowerCase().replace(/-\d+$/, ''));
        }
        const appBlocks: string[] = [];
        for (const el of Array.from(document.querySelectorAll('[id^="shopify-block-"]'))) {
          const m = el.id.match(/__([a-z0-9][a-z0-9_-]{2,80})_[A-Za-z0-9]{6}$/);
          if (m && !appBlocks.includes(m[1]!) && appBlocks.length < 60) appBlocks.push(m[1]!);
        }
        const appHandles: string[] = [];
        const tw = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
        let n: Node | null;
        let guard = 0;
        while ((n = tw.nextNode()) && guard++ < 5000) {
          const m =
            /^\s*BEGIN app block: shopify:\/\/apps\/([a-z0-9][a-z0-9-]{1,80})\/blocks\//.exec(
              n.nodeValue ?? '',
            );
          if (m && !appHandles.includes(m[1]!) && appHandles.length < 80) appHandles.push(m[1]!);
        }
        const meta = (p: string) =>
          document
            .querySelector(`meta[property="${p}"], meta[name="${p}"]`)
            ?.getAttribute('content') ?? null;
        return {
          main,
          dom: {
            url: location.href,
            hostname: location.hostname,
            title: document.title,
            scripts,
            links,
            resources,
            selectorHits,
            extensionHandles: [...handles],
            appBlocks,
            appHandles,
            htmlHints: {
              shopifyCdn: /cdn\.shopify\.com/.test(everything),
              cdnShopPath: /\/cdn\/shop\//.test(everything),
              myshopifyRef: /\.myshopify\.com/.test(
                document.documentElement.innerHTML.slice(0, 400000),
              ),
              shopifyFeatures: !!document.getElementById('shopify-features'),
            },
          },
          siteName: meta('og:site_name'),
          challenge: /captcha|challenge|verify you are human|access denied/i.test(
            document.title + ' ' + (document.body?.innerText ?? '').slice(0, 400),
          ),
        };
      },
      { globalsToProbe, selectorsToProbe },
    );
    const result = engine.analyze(raw, engine.db, engine.themes, engine.premium);
    const t = result.theme;
    const themeName =
      t && !t.notExposed ? (t.officialName ?? t.baseName ?? t.displayName ?? null) : null;
    const scan: ScanInput = {
      domain,
      url: raw.dom.url,
      scanned_at: new Date().toISOString(),
      source: 'vitrine-crawl',
      rules_version: engine.version,
      http_status: res?.status() ?? null,
      platform: raw.challenge && !raw.main.isShopify ? 'not-shopify' : result.platform,
      site_name: cleanSiteName(raw.siteName),
      currency: result.shop?.currency ?? raw.main.shopify?.currency ?? null,
      theme: themeName
        ? {
            name: themeName,
            raw_name: t?.merchantName ?? null,
            version: t?.baseVersion ?? null,
            theme_store_id: t?.themeStoreId ?? null,
            is_custom: !!t?.isCustom,
          }
        : null,
      apps: result.apps.map((a) => ({ slug: a.slug, confidence: a.confidence })),
      pixels: result.pixels.map((p) => PIXEL_ALIASES[p.slug] ?? p.slug),
    };
    return {
      scan,
      country: raw.main.shopify?.country ?? null,
      note: raw.challenge ? 'bot check' : null,
    };
  } finally {
    await context.close();
  }
}

/** og:site_name as the store publishes it, minus "| Official Site" style tails. */
export function cleanSiteName(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name
    .replace(/\s*[|–—-]\s*(official( site| store| online store)?|online store|shop online).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length >= 2 && clean.length <= 80 ? clean : null;
}
