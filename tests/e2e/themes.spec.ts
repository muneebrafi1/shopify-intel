import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Themes index (/themes) and theme detail (/themes/<slug>). Runs at 390px and 1440px
 * (see playwright.config.ts) against the seeded local data.
 */

const ROUTES = [
  '/themes',
  '/themes?view=index',
  '/themes?price=free',
  '/themes?price=400-plus&sort=name',
  '/themes?vendor=maestrooo&view=index',
  '/themes?price=paid&vendor=shopify',
  '/themes/prestige',
  '/themes/dawn',
  '/themes/hyper',
  '/themes/enterprise',
  '/themes/prestige?page=cart&device=mobile',
];

test.describe('themes pages are healthy', () => {
  for (const path of ROUTES) {
    test(path, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('unknown theme slugs are 404s', async ({ page }) => {
    await expectHealthyPage(page, '/themes/not-a-real-theme', { status: 404 });
  });
});

test.describe('themes index', () => {
  test('filters change the results', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes');
    const cards = page.locator('.theme-card');
    const all = await cards.count();
    expect(all).toBeGreaterThan(2);
    await expect(page.locator('.fbar__total')).toContainText(String(all));

    await page.goto('/themes?price=free');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('.theme-card__name')).toHaveText(['Dawn', 'Horizon']);
    await expect(page.locator('.fbar__total')).toContainText('2');
    // The active filter is shown as a removable chip that clears it.
    const chip = page.locator('.fbar__active a', { hasText: 'Free' });
    await expect(chip).toHaveAttribute('href', '/themes');

    await page.goto('/themes?vendor=maestrooo');
    await expect(page.locator('.theme-card__name')).toHaveText(['Prestige', 'Impact', 'Stretch']);
  });

  test('an empty filter combination says what to do next', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes?price=paid&vendor=shopify');
    await expect(page.locator('.theme-card')).toHaveCount(0);
    await expect(page.getByText('No themes match these filters')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/themes',
    );
  });

  test('?view=index renders the numbered index', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes?view=index');
    await expect(page.locator('.theme-card')).toHaveCount(0);
    const rows = page.locator('.index .irow');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(2);
    await expect(rows.first()).toContainText('N°001');
    await expect(rows.first()).toContainText('Dawn');
    await expect(rows.first().locator('a')).toHaveAttribute('href', '/themes/dawn');
  });

  test('vendor index links to the vendor filter', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes');
    const link = page.locator('.vstrip a', { hasText: 'Maestrooo' });
    await expect(link).toHaveAttribute('href', '/themes?vendor=maestrooo');
  });
});

test.describe('theme detail', () => {
  test('specimen header, spec rows and an official CTA', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/prestige');
    await expect(page.locator('h1')).toHaveText('Prestige');
    await expect(page.getByText(/^N°\d{3} — Theme$/)).toBeVisible();
    const specs = page.locator('.th-head .specs');
    for (const label of [
      'Vendor',
      'Price',
      'Theme Store ID',
      'Latest version seen',
      'Stores in scan',
    ]) {
      await expect(specs.locator('dt', { hasText: label })).toBeVisible();
    }
    await expect(specs.locator('a', { hasText: 'Maestrooo' })).toHaveAttribute(
      'href',
      '/themes?vendor=maestrooo',
    );
    const cta = page.locator('.th-head .cta a.btn');
    await expect(cta).not.toHaveAttribute('rel', /sponsored/);
    await expect(page.locator('.th-head .cta')).toContainText('No affiliate relationship');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.join('\n')).toContain('BreadcrumbList');
  });

  test('affiliate CTA is labelled and sponsored', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/hyper');
    const cta = page.locator('.th-head .cta a.btn');
    await expect(cta).toHaveAttribute('rel', /sponsored/);
    await expect(cta).toHaveAttribute('href', /^\/go\//);
    await expect(page.locator('.th-head .cta')).toContainText('Affiliate');
  });

  test('page-type tabs and the device toggle switch the plates', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/dawn');
    const plates = page.locator('#plates');
    const visible = plates.locator('[data-plate-panel]:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible).toHaveAttribute('data-page', 'home');
    await expect(visible).toHaveAttribute('data-device', 'desktop');

    await plates.locator('.plates__tabs a', { hasText: 'Collection' }).click();
    await expect(visible).toHaveAttribute('data-page', 'collection');
    await expect(plates.locator('.plates__tabs a[aria-current="page"]')).toHaveText('Collection');
    await expect(page).toHaveURL(/page=collection/);

    await plates.locator('.plates__device a', { hasText: 'Mobile' }).click();
    await expect(visible).toHaveAttribute('data-device', 'mobile');
    await expect(visible).toHaveAttribute('data-page', 'collection');
    await expect(page).toHaveURL(/device=mobile/);
    const img = visible.locator('img').first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', /collection page.*mobile/);
    // Captures link to the store page at the same page type and device.
    await expect(visible.locator('a').first()).toHaveAttribute(
      'href',
      /\/stores\/[^?]+\?page=collection&device=mobile/,
    );
  });

  test('plate state works from the URL without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/themes/prestige?page=product&device=mobile');
    const visible = page.locator('#plates [data-plate-panel]:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible).toHaveAttribute('data-page', 'product');
    await expect(visible).toHaveAttribute('data-device', 'mobile');
    await expect(page.locator('.plates__tabs a[aria-current="page"]')).toHaveText('Product');
    await context.close();
  });

  test('stores using the theme link to their store pages', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/prestige');
    const rows = page.locator('#stores .irow');
    expect(await rows.count()).toBeGreaterThan(1);
    const hrefs = await rows
      .locator('a')
      .evaluateAll((els) => els.map((a) => a.getAttribute('href')));
    for (const href of hrefs) expect(href).toMatch(/^\/stores\/[a-z0-9.-]+$/);
    await expect(page.locator('#stores')).toContainText('Not captured');
  });
});
