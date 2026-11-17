import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Apps area: index (ranked rows + grid), categories catalogue, category pages and app detail
 * ("specimen sheet"). Runs at 390px and 1440px (see playwright.config.ts).
 */

const ROUTES = [
  '/apps',
  '/apps?view=grid',
  '/apps?category=reviews&sort=rating',
  '/apps?p=2',
  '/apps/categories',
  '/apps/categories/reviews',
  '/apps/categories/analytics',
  '/apps/judgeme',
  '/apps/judgeme?device=mobile',
  '/apps/judgeme?p=2',
  '/apps/klaviyo',
  '/apps/appstlesubscriptions',
  '/apps/helpdesk',
  '/apps/amp-back-in-stock',
  '/apps/easylocation',
];

test.describe('apps pages are healthy', () => {
  for (const path of ROUTES) {
    test(path, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('unknown app and category slugs are 404s', async ({ page }) => {
    await expectHealthyPage(page, '/apps/not-a-real-app', { status: 404 });
    await expectHealthyPage(page, '/apps/categories/not-a-category', { status: 404 });
  });
});

test.describe('apps index', () => {
  test('category filter narrows the ranked rows', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps');
    const all = await page.locator('.app-row').count();
    expect(all).toBeGreaterThan(20);

    await page.goto('/apps?category=reviews');
    const rows = page.locator('.app-row');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(all);
    for (const sub of await page.locator('.app-row__sub').allInnerTexts())
      expect(sub).toContain('Reviews');
    await expect(page.locator('.fbar__total')).toContainText(`${n} apps`);
    await expect(page.locator('.fbar__active')).toContainText('Category: Reviews');
  });

  test('desktop category rail links keep URL state', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'rail is desktop only');
    await prepare(page);
    await page.goto('/apps?sort=rating');
    await page.locator('nav[aria-label="App categories"] a', { hasText: 'Subscriptions' }).click();
    await expect(page).toHaveURL(/category=subscriptions/);
    await expect(page).toHaveURL(/sort=rating/);
  });

  test('grid view shows plates and lists apps without one', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps?view=grid');
    await expect(page.locator('.atile').first()).toBeVisible();
    await expect(page.locator('.atile img').first()).toHaveAttribute('src', /\/media\//);
    await expect(page.locator('.plain').first()).toBeVisible();
  });

  test('pagination reaches the end of the ranking', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps?p=2');
    await expect(page.locator('.pager__status')).toContainText('61–');
  });
});

test.describe('app categories', () => {
  test('catalogue lists every category by reach and links to it', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/categories');
    const entries = page.locator('.centry');
    expect(await entries.count()).toBeGreaterThan(10);
    await expect(entries.first().locator('.centry__n')).toHaveText('N°01');
    await expect(page.locator('a[href="/apps/categories/reviews"]').first()).toBeVisible();
  });

  test('category page ranks its apps and links head to head', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/categories/reviews');
    await expect(page.locator('h1')).toContainText('Reviews');
    expect(await page.locator('.app-row').count()).toBeGreaterThan(2);
    await expect(page.locator('a[href^="/compare/"]').first()).toBeAttached();
    await expect(page.locator('#where a[href*="#section-"]').first()).toBeAttached();
  });
});

test.describe('app detail', () => {
  test('judge.me is a full specimen sheet', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/judgeme');
    await expect(page.locator('h1')).toHaveText('Judge.me');
    await expect(page.getByText('N°002 — App')).toBeVisible();
    for (const label of [
      'Category',
      'Rating',
      'Price from',
      'Free plan',
      'Trial',
      'Built for Shopify',
      'Launched',
      'Languages',
    ]) {
      await expect(
        page.locator('.specs__label', { hasText: new RegExp(`^${label}$`, 'i') }),
      ).toHaveCount(1);
    }
    await expect(page.locator('.specs')).toContainText('App Store, checked 17 Nov 2026');
    // Where it shows up: plates link into the store viewer, anchored at the section.
    const plate = page.locator('#where a[href*="#section-"]').first();
    await expect(plate).toHaveAttribute(
      'href',
      /^\/stores\/[^?]+\?page=\w+&device=desktop#section-\d+$/,
    );
    // Stores running it, plans, relationships.
    expect(await page.locator('#stores .irow').count()).toBe(24);
    await expect(page.locator('.plan')).toHaveCount(2);
    await expect(page.locator('a[href="/alternatives/judgeme"]')).toBeVisible();
    await expect(page.locator('a[href^="/compare/"]').first()).toBeVisible();
    // JSON-LD: SoftwareApplication with the App Store rating only.
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const app = ld.map((t) => JSON.parse(t)).find((o) => o['@type'] === 'SoftwareApplication');
    expect(app.aggregateRating.ratingValue).toBe(5);
    expect(app.aggregateRating.reviewCount).toBe(50275);
    expect(app.offers.length).toBe(2);
  });

  test('device toggle switches the plates to mobile', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/judgeme?device=mobile');
    await expect(page.locator('#where a[href*="#section-"]').first()).toHaveAttribute(
      'href',
      /device=mobile/,
    );
  });

  test('klaviyo links to its official listing without affiliate labelling', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/klaviyo');
    const cta = page.locator('.cta a').first();
    await expect(cta).toHaveAttribute('href', /apps\.shopify\.com/);
    await expect(cta).not.toHaveAttribute('rel', /sponsored/);
    await expect(page.locator('.cta__note')).toContainText('Official listing');
  });

  test('appstle affiliate CTA is sponsored and labelled', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/appstlesubscriptions');
    const cta = page.locator('.cta a').first();
    await expect(cta).toHaveAttribute('href', /^\/go\/\d+$/);
    await expect(cta).toHaveAttribute('rel', /sponsored/);
    await expect(page.locator('.cta__note')).toContainText('Affiliate link');
  });

  test('basic-profile app says what is known and what is missing', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/amp-back-in-stock');
    await expect(page.getByText('Basic profile')).toBeVisible();
    await expect(page.locator('.specs__label', { hasText: /not checked yet/i })).toBeVisible();
    await expect(page.locator('.plan')).toHaveCount(0);
    await expect(page.locator('#stores .irow').first()).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const app = ld.map((t) => JSON.parse(t)).find((o) => o['@type'] === 'SoftwareApplication');
    expect(app.aggregateRating).toBeUndefined();
  });

  test('alias slugs redirect permanently to the canonical app', async ({ request }) => {
    const res = await request.get('/apps/boldupsell', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toMatch(/\/apps\/product-upsell$/);
  });
});
