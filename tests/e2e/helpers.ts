import { expect, type Page } from '@playwright/test';

// 1x1 transparent PNG used for every third-party image, so runs are deterministic and offline.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Block third-party requests (App Store icons etc.) and collect page errors. */
export async function prepare(page: Page): Promise<string[]> {
  const errors: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
      : route.abort(),
  );
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

/** Load every lazy image by scrolling through the page. */
export async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
}

/** The page must never be wider than the viewport. */
export async function expectNoHorizontalOverflow(page: Page) {
  const offenders = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`document scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    // Name the widest elements that escape the viewport (ignoring ones inside scrollers).
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      let p = el.parentElement;
      let clipped = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
          clipped = true;
          break;
        }
        p = p.parentElement;
      }
      if (!clipped && getComputedStyle(el).position !== 'fixed') {
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)}`);
      }
      if (out.length > 5) break;
    }
    return out;
  });
  expect(offenders, `Horizontal overflow:\n${offenders.join('\n')}`).toEqual([]);
}

interface HealthyOptions {
  status?: number;
  /** Expect exactly one <h1>. */
  h1?: boolean;
}

/**
 * The baseline every page must pass at both widths: right status, one h1, a title, no JS
 * errors, no horizontal overflow, all images with alt, all buttons/links named.
 */
export async function expectHealthyPage(page: Page, path: string, opts: HealthyOptions = {}) {
  const errors = await prepare(page);
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(res?.status(), `status for ${path}`).toBe(opts.status ?? 200);
  await page.waitForLoadState('load');
  await scrollThrough(page);
  if (opts.h1 !== false) await expect(page.locator('h1')).toHaveCount(1);
  await expect(page).toHaveTitle(/.+/);
  await expectNoHorizontalOverflow(page);
  const unnamed = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('a[href], button'))
      .filter((el) => el.offsetParent !== null)
      .filter((el) => !(el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.querySelector('img[alt]:not([alt=""])')))
      .map((el) => el.outerHTML.slice(0, 120)),
  );
  expect(unnamed, 'links/buttons without an accessible name').toEqual([]);
  const missingAlt = await page.locator('img:not([alt])').count();
  expect(missingAlt, 'images without alt').toBe(0);
  expect(errors, 'page errors').toEqual([]);
}
