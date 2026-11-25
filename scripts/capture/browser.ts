/**
 * Browser side of the capture pipeline: open a store page like a visitor would, get popups and
 * consent banners out of the way, load lazy content, then take a full-page screenshot and read
 * the section boxes from the DOM. No logins, no form submissions, no bypassing of bot checks:
 * a page that does not render plainly is reported as failed.
 */
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import type { RawSection } from './classify.ts';

export type CaptureDevice = 'desktop' | 'mobile';

export interface DeviceProfile {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  /** Captures are cut at this CSS height (WebP is limited to 16383 px per side). */
  maxHeight: number;
  context: BrowserContextOptions;
}

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

export const DEVICE_PROFILES: Record<CaptureDevice, DeviceProfile> = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    maxHeight: 14000,
    context: { userAgent: CHROME_UA },
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    maxHeight: 8000,
    context: { userAgent: IPHONE_UA, isMobile: true, hasTouch: true },
  },
};

export interface PageCapture {
  url: string;
  /** One full-page PNG, or viewport tiles to stitch (document y in CSS px) for `stitch`. */
  png?: Buffer;
  tiles?: Array<{ y: number; png: Buffer }>;
  viewportHeight: number;
  /** CSS px of the stored capture (after the height cap). */
  width: number;
  height: number;
  fullHeight: number;
  truncated: boolean;
  deviceScaleFactor: number;
  sections: RawSection[];
  title: string;
}

export type CaptureFailure = 'not-shopify' | 'password' | 'challenge' | 'http' | 'empty';

export class CaptureError extends Error {
  readonly reason: CaptureFailure;
  constructor(reason: CaptureFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Accept/close buttons of the usual consent tools and store popups (clicked when visible). */
const DISMISS_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '.shopify-pc__banner__btn-accept',
  '[data-testid="uc-accept-all-button"]',
  '.cc-allow',
  '.klaviyo-close-form',
  '[aria-label="Close dialog"]',
  '[aria-label="Close form"]',
  '[aria-label="Close popup"]',
  '.needsclick[aria-label*="close" i]',
  '#attentive_overlay [aria-label*="close" i]',
  '.privy-dismiss-content',
  '.modal [aria-label*="close" i]',
  'button.popup-close',
];

/** Third-party widgets that float over the page; hidden, never interacted with. */
const HIDE_CSS = `
  #shopify-pc__banner, #onetrust-consent-sdk, #CybotCookiebotDialog, .cc-window, #usercentrics-root,
  #attentive_overlay, #attentive_creative, [id^="attentive"], .privy-popup-container, #privy-container,
  .kl-private-reset-css-Xuajs1, div[class*="klaviyo-form"][role="dialog"], [data-testid="POPUP"],
  #gorgias-chat-container, #launcher, #shopify-chat, inbox-online-store-chat, #chat-button,
  iframe[title*="chat" i], iframe[id*="chat" i], #tidio-chat, #hubspot-messages-iframe-container,
  .fb_dialog, #smile-ui-container, #smile-ui-lite-launcher-frame-container, #ps__widget,
  #shopify-section-popup, .geolocation-popup, #recover-popup, [id*="cookie-banner" i],
  pandectes-cmp, #pandectes-banner, #cmplz-cookiebanner-container, .termly-styles-root,
  #truste-consent-track, #cookie-law-info-bar, .cky-consent-container, #ccc {
    display: none !important;
  }
  html, body { overflow: visible !important; }
`;

async function dismissOverlays(page: Page) {
  for (const sel of DISMISS_SELECTORS) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) await el.click({ timeout: 1500 }).catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
  // Anything else that floats over the page outside the theme's header: chat bubbles, promo
  // modals, geo popups. Fixed elements inside header-group sections (sticky headers) stay.
  await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      if (el.closest('.shopify-section-group-header-group, header')) continue;
      const r = el.getBoundingClientRect();
      const z = Number.parseInt(cs.zIndex, 10) || 0;
      // Consent tools often mount a zero-size custom element whose shadow root draws the dialog.
      if ((r.width === 0 || r.height === 0) && !(el.shadowRoot && z >= 1000)) continue;
      const covers = (r.width * r.height) / (vw * vh) > 0.15;
      if (covers || z >= 1000 || r.width < vw * 0.6)
        el.style.setProperty('display', 'none', 'important');
    }
    document.documentElement.style.setProperty('overflow', 'visible', 'important');
    document.body.style.setProperty('overflow', 'visible', 'important');
  });
}

/** Scrolls to the bottom in viewport steps so lazy images and scroll animations fire. */
async function loadLazyContent(page: Page, maxHeight: number) {
  await page.evaluate(async (limit) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    document
      .querySelectorAll('img[loading="lazy"]')
      .forEach((img) => img.setAttribute('loading', 'eager'));
    let y = 0;
    while (y < Math.min(document.documentElement.scrollHeight, limit + 2000)) {
      y += Math.round(window.innerHeight * 0.8);
      window.scrollTo(0, y);
      await sleep(220);
    }
    window.scrollTo(0, 0);
    await sleep(300);
    const pending = Array.from(document.images).filter((i) => !i.complete);
    await Promise.race([
      Promise.all(
        pending.map((i) => new Promise((r) => i.addEventListener('loadend', r, { once: true }))),
      ),
      sleep(8000),
    ]);
  }, maxHeight);
}

/** Box of a sub-element in document CSS px. */
export interface SubBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function readSections(page: Page): Promise<RawSection[]> {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
    };
    // Main product sections hold two regions we name separately: the media gallery and the
    // buy box (the column with the add-to-cart form).
    const productSplit = (sec: HTMLElement) => {
      const form = sec.querySelector('form[action*="/cart/add"]');
      if (!form) return null;
      const s = box(sec);
      let buy: Element = form;
      for (let el = form.parentElement; el && el !== sec; el = el.parentElement) {
        const b = box(el);
        if (b.w > s.w * 0.72) break;
        buy = el;
      }
      const buyBox = box(buy);
      let gallery: Element | null = null;
      let best = 0;
      for (const el of Array.from(sec.querySelectorAll('*'))) {
        if (el.contains(buy) || buy.contains(el) || !el.querySelector('img')) continue;
        const b = box(el);
        if (b.w < s.w * 0.3 || b.h < 150 || b.w > s.w * 0.8) continue;
        const sideBySide = b.x + b.w <= buyBox.x + 4 || b.x >= buyBox.x + buyBox.w - 4;
        const stacked = b.y + b.h <= buyBox.y + 4;
        if (!sideBySide && !stacked) continue;
        if (b.w * b.h > best) {
          best = b.w * b.h;
          gallery = el;
        }
      }
      return gallery ? { gallery: box(gallery), buy: buyBox } : { gallery: null, buy: buyBox };
    };
    return Array.from(
      document.querySelectorAll<HTMLElement>('.shopify-section[id^="shopify-section-"]'),
    )
      .filter((el) => !el.parentElement?.closest('.shopify-section'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          className: el.className,
          y: r.top + window.scrollY,
          height: r.height,
          appBlocks: Array.from(el.querySelectorAll('.shopify-app-block[id]')).map((b) => b.id),
          split: productSplit(el),
        };
      });
  });
}

export type CapturePageType = 'home' | 'collection' | 'product' | 'cart';

export interface DiscoveredPages {
  collection: string | null;
  product: string | null;
}

/** Finds a collection and a product page from the home page links (main content first). */
export async function discoverPages(browser: Browser, homeUrl: string): Promise<DiscoveredPages> {
  const context = await browser.newContext({
    ...DEVICE_PROFILES.desktop.context,
    viewport: DEVICE_PROFILES.desktop.viewport,
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2500);
    const found = await page.evaluate(() => {
      const skip = new Set(['all', 'frontpage', 'vendors', 'types', 'sale', 'gift-card']);
      const pick = (re: RegExp) => {
        const anchors = [
          ...Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href]')),
          ...Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')),
        ];
        for (const a of anchors) {
          if (a.origin !== location.origin) continue;
          const m = re.exec(a.pathname);
          if (m && !skip.has(m[1] ?? '')) return a.origin + a.pathname;
        }
        return null;
      };
      return {
        collection: pick(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/([^/]+)\/?$/),
        product: pick(
          /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/,
        ),
      };
    });
    if (!found.product) {
      // Storefront JSON every Shopify store serves: the newest product.
      const handle = await page.evaluate(async () => {
        const r = await fetch('/products.json?limit=1').catch(() => null);
        const j = r && r.ok ? ((await r.json()) as { products?: Array<{ handle: string }> }) : null;
        return j?.products?.[0]?.handle ?? null;
      });
      if (handle) found.product = new URL(`/products/${handle}`, page.url()).href;
    }
    return {
      collection: found.collection ?? new URL('/collections/all', page.url()).href,
      product: found.product,
    };
  } finally {
    await context.close();
  }
}

/**
 * Puts one item in the cart so the cart page shows its real layout. This uses the storefront
 * cart API exactly like the theme's own "Add to cart" button: no checkout, no account, nothing
 * personal; the cart lives only in this throwaway browser context.
 */
async function addOneToCart(page: Page, productUrl: string) {
  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const ok = await page.evaluate(async (path) => {
    type V = { id: number; available: boolean };
    const add = async (v: V | undefined) => {
      if (!v) return false;
      const r = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: v.id, quantity: 1 }] }),
      }).catch(() => null);
      return !!r && r.ok;
    };
    const json = async <T>(url: string) => {
      const r = await fetch(url).catch(() => null);
      return r && r.ok ? ((await r.json().catch(() => null)) as T | null) : null;
    };
    const p = await json<{ variants?: V[] }>(`${path.replace(/\/$/, '')}.js`);
    if (await add(p?.variants?.find((x) => x.available))) return true;
    // The featured product is sold out (or its variant is restricted): any product in stock.
    const list = await json<{ products?: Array<{ variants?: V[] }> }>('/products.json?limit=30');
    for (const item of list?.products ?? []) {
      const v = item.variants?.find((x) => x.available);
      if (v) return add(v);
    }
    return add(p?.variants?.[0]);
  }, new URL(productUrl).pathname);
  if (!ok) throw new CaptureError('empty', 'could not put an item in the cart');
}

/**
 * Viewport-by-viewport capture, stitched by the caller: for sites that only draw content while
 * it is in the real viewport (scroll-driven reveals), where a one-shot full-page capture comes
 * out partly blank. Fixed and sticky elements are hidden after the first tile so the header
 * is not repeated down the page.
 */
async function captureTiles(page: Page, height: number, profile: DeviceProfile) {
  const tiles: Array<{ y: number; png: Buffer }> = [];
  const vh = profile.viewport.height;
  const maxTiles = Math.ceil(height / vh) + 2;
  let y = 0;
  let last = -1;
  while (y < height && tiles.length < maxTiles) {
    const actual = await page.evaluate(async (target) => {
      window.scrollTo(0, target);
      await new Promise((r) => setTimeout(r, 450));
      return Math.round(window.scrollY);
    }, y);
    if (actual <= last) break; // the page cannot scroll further
    last = actual;
    const png = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
      timeout: 30_000,
    });
    tiles.push({ y: actual, png });
    if (tiles.length === 1)
      await page.evaluate(() => {
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
          const p = getComputedStyle(el).position;
          if (p === 'fixed' || p === 'sticky')
            el.style.setProperty('visibility', 'hidden', 'important');
        }
      });
    if (actual + vh >= height) break; // reached the bottom of the capture
    y = actual + vh;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return tiles;
}

export async function capturePage(
  browser: Browser,
  url: string,
  device: CaptureDevice,
  opts: { pageType?: CapturePageType; stitch?: boolean; productUrl?: string | null } = {},
): Promise<PageCapture> {
  const profile = DEVICE_PROFILES[device];
  const context = await browser.newContext({
    ...profile.context,
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    locale: 'en-US',
    // Not 'reduce': some themes then never reveal their slideshow. Scrolling triggers the
    // scroll animations instead.
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    if (opts.pageType === 'cart') {
      if (!opts.productUrl) throw new CaptureError('empty', 'no product to put in the cart');
      await addOneToCart(page, opts.productUrl);
    }
    const res = await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(async (e) => {
      // Pages with endless trackers never fire `load`; the DOM is enough to go on.
      if (!String(e).includes('Timeout')) throw e;
      return null;
    });
    if (res && res.status() >= 400) throw new CaptureError('http', `HTTP ${res.status()}`);
    await page.waitForTimeout(2500);

    const probe = await page.evaluate(() => ({
      shopify: typeof (window as unknown as { Shopify?: unknown }).Shopify === 'object',
      password: location.pathname.startsWith('/password'),
      title: document.title,
    }));
    if (/just a moment|attention required|access denied|verify you are human/i.test(probe.title))
      throw new CaptureError('challenge', `bot check: "${probe.title}"`);
    if (probe.password) throw new CaptureError('password', 'store is password protected');
    if (!probe.shopify) throw new CaptureError('not-shopify', 'no window.Shopify on the page');

    await dismissOverlays(page);
    await loadLazyContent(page, profile.maxHeight);
    await page.waitForTimeout(1500);
    await dismissOverlays(page); // popups that open on scroll or after a delay
    await page.waitForTimeout(2500);
    await dismissOverlays(page); // consent tools that mount late (seen ~6 s after load)
    // Themes open their cart drawer after an add; the page behind it is what we want.
    if (opts.pageType === 'cart') await page.keyboard.press('Escape').catch(() => {});

    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (fullHeight < 300) throw new CaptureError('empty', `page is ${fullHeight}px tall`);
    const height = Math.min(fullHeight, profile.maxHeight);
    const sections = await readSections(page);
    const shot = opts.stitch
      ? { tiles: await captureTiles(page, height, profile) }
      : {
          png: await page.screenshot({
            fullPage: true,
            clip: { x: 0, y: 0, width: profile.viewport.width, height },
            animations: 'disabled',
            caret: 'hide',
            type: 'png',
            timeout: 60_000,
          }),
        };
    return {
      url: page.url(),
      ...shot,
      width: profile.viewport.width,
      height,
      fullHeight,
      truncated: fullHeight > height,
      deviceScaleFactor: profile.deviceScaleFactor,
      viewportHeight: profile.viewport.height,
      sections,
      title: probe.title,
    };
  } finally {
    await context.close();
  }
}
