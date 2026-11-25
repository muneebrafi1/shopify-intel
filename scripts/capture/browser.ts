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
  png: Buffer;
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

function readSections(page: Page): Promise<RawSection[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.shopify-section[id^="shopify-section-"]'))
      .filter((el) => !el.parentElement?.closest('.shopify-section'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          className: el.className,
          y: r.top + window.scrollY,
          height: r.height,
          appBlocks: Array.from(el.querySelectorAll('.shopify-app-block[id]')).map((b) => b.id),
        };
      }),
  );
}

export async function capturePage(
  browser: Browser,
  url: string,
  device: CaptureDevice,
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

    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (fullHeight < 300) throw new CaptureError('empty', `page is ${fullHeight}px tall`);
    const height = Math.min(fullHeight, profile.maxHeight);
    const sections = await readSections(page);
    const png = await page.screenshot({
      fullPage: true,
      clip: { x: 0, y: 0, width: profile.viewport.width, height },
      animations: 'disabled',
      caret: 'hide',
      type: 'png',
      timeout: 60_000,
    });
    return {
      url: page.url(),
      png,
      width: profile.viewport.width,
      height,
      fullHeight,
      truncated: fullHeight > height,
      deviceScaleFactor: profile.deviceScaleFactor,
      sections,
      title: probe.title,
    };
  } finally {
    await context.close();
  }
}
