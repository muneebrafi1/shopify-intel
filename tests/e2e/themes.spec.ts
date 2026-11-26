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
  '/themes?q=maestro',
  '/themes?q=zzzz',
  '/themes/prestige',
  '/themes/dawn',
  '/themes/hyper',
  '/themes/enterprise',
  '/themes/prestige?page=collection&device=mobile',
  '/themes/dawn?page=product&device=mobile',
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
    // Price is the pill row: the selected pill is marked, "Any price" clears it.
    const pills = page.locator('.fbar__pills');
    await expect(pills.locator('a[aria-current="true"]')).toHaveText(/Free/);
    await expect(pills.locator('a', { hasText: 'Any price' })).toHaveAttribute('href', '/themes');

    await page.goto('/themes?vendor=maestrooo');
    await expect(page.locator('.theme-card__name')).toHaveText(['Prestige', 'Impact', 'Stretch']);
    // Other filters show as removable chips that clear them.
    const chip = page.locator('.fbar__active a', { hasText: 'Maestrooo' });
    await expect(chip).toHaveAttribute('href', '/themes');
  });

  test('search narrows the themes and keeps the other filters', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes?price=paid');
    const field = page.locator('.fbar__search input[name="q"]');
    await field.fill('maestro');
    await field.press('Enter');
    await page.waitForURL(/q=maestro/);
    expect(new URL(page.url()).searchParams.get('price')).toBe('paid');
    await expect(page.locator('.theme-card__name')).toHaveText(['Prestige', 'Impact', 'Stretch']);
    await expect(field).toHaveValue('maestro');
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

  test('cards show usage share and rank; equal usage shares a rank', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes');
    await expect(page.getByText(/N°/)).toHaveCount(0);
    const card = (name: string) =>
      page.locator('.theme-card', { has: page.locator('.theme-card__name', { hasText: name }) });
    await expect(card('Dawn').locator('.theme-card__rank')).toHaveText('#1');
    await expect(card('Dawn').locator('.theme-card__count')).toContainText('%');
    // Hyper, Impact and Impulse run on the same number of stores.
    for (const name of ['Hyper', 'Impact', 'Impulse']) {
      await expect(card(name).locator('.theme-card__rank')).toHaveText('#6');
    }
    await expect(card('Flow').locator('.theme-card__rank')).toHaveText('#9');
  });

  test('?view=index renders the ranked table', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes?view=index');
    await expect(page.locator('.theme-card')).toHaveCount(0);
    const rows = page.locator('.ttable tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(2);
    await expect(rows.first()).toContainText('#1');
    await expect(rows.first()).toContainText('Dawn');
    await expect(rows.first().locator('a')).toHaveAttribute('href', '/themes/dawn');
    await expect(rows.filter({ hasText: 'Impact' })).toContainText('#6');
    await expect(page.getByText(/N°/)).toHaveCount(0);
  });

  test('vendor index links to the vendor filter', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes');
    const link = page.locator('.vstrip a', { hasText: 'Maestrooo' });
    await expect(link).toHaveAttribute('href', '/themes?vendor=maestrooo');
  });
});

test.describe('theme detail', () => {
  test('identity row, facts card and an official CTA', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/prestige');
    await expect(page.locator('h1')).toHaveText('Prestige');
    await expect(page.getByText(/N°/)).toHaveCount(0);
    const chips = page.locator('.th-chips');
    await expect(chips).toContainText('$400');
    await expect(chips).toContainText('#3 most used');
    await expect(chips.locator('a', { hasText: 'Maestrooo' })).toHaveAttribute(
      'href',
      '/themes?vendor=maestrooo',
    );
    const facts = page.locator('.th-side .fcard');
    for (const label of [
      'Price',
      'Vendor',
      'Stores using it',
      'Rank by usage',
      'Latest version seen',
      'Theme Store ID',
    ]) {
      await expect(facts.locator('dt', { hasText: label })).toBeVisible();
    }
    await expect(facts).toContainText('#3 of 20 themes');
    await expect(facts).toContainText('13 of 930');
    await expect(facts).toContainText('Source:');
    // Theme Store facts, sourced and dated.
    await expect(facts.locator('dt', { hasText: 'Presets' })).toBeVisible();
    await expect(facts).toContainText('Couture');
    await expect(facts.locator('dt', { hasText: 'Theme Store reviews' })).toBeVisible();
    await expect(
      facts.locator('a[href="https://themes.shopify.com/themes/prestige"]'),
    ).toBeVisible();
    const features = page.locator('#features');
    await expect(features.getByRole('heading', { name: 'Published features' })).toBeVisible();
    await expect(features.getByRole('heading', { name: 'Cart and checkout' })).toBeVisible();
    await expect(features).toContainText('Quick buy');
    await expect(features).toContainText('Shopify Theme Store · checked');

    const actions = page.locator('.th-actions');
    const cta = actions.locator('.cta a.btn');
    await expect(cta).toHaveAttribute('href', 'https://themes.shopify.com/themes/prestige');
    await expect(cta).not.toHaveAttribute('rel', /sponsored/);
    await expect(actions.locator('.cta')).toContainText('No affiliate relationship');
    await expect(actions.getByRole('link', { name: 'Compare' })).toHaveAttribute(
      'href',
      '#compare',
    );
    await expect(actions.getByRole('link', { name: 'Save' })).toHaveAttribute(
      'href',
      `/account/save?item=${encodeURIComponent('theme:prestige')}&back=${encodeURIComponent('/themes/prestige')}`,
    );
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.join('\n')).toContain('BreadcrumbList');
  });

  test('Hyper links to the Theme Store without an affiliate link', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/hyper');
    const cta = page.locator('.th-actions .cta a.btn');
    await expect(cta).toHaveAttribute('href', 'https://themes.shopify.com/themes/hyper');
    await expect(cta).not.toHaveAttribute('rel', /sponsored/);
    await expect(page.locator('.th-actions .cta')).toContainText('No affiliate relationship');
    await expect(page.locator('.th-actions .cta')).not.toContainText('Affiliate link');
    // The dropped affiliate link is gone (owner decision): its redirect id is unused.
    const go = await page.request.get('/go/4', { maxRedirects: 0 });
    expect(go.status()).toBe(404);
    // Ties share a rank: Hyper, Impact and Impulse all run on 8 stores.
    await expect(page.locator('.th-chips')).toContainText('#6 most used');
  });

  test('affiliate CTAs are labelled and sponsored (shared AffiliateCta path)', async ({ page }) => {
    // No theme has an affiliate link right now; the design-system page renders the same
    // AffiliateCta the theme page uses with isAffiliate, so the labelling path stays covered.
    await prepare(page);
    await page.goto('/design-system');
    const cta = page.locator('.cta', { hasText: 'Get Prestige' });
    await expect(cta.locator('a.btn')).toHaveAttribute('rel', /sponsored/);
    await expect(cta).toContainText('Affiliate link');
    await expect(cta.getByRole('link', { name: 'Disclosure' })).toHaveAttribute(
      'href',
      '/affiliate-disclosure',
    );
  });

  test('page-type tabs and the device switch change the capture', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/dawn');
    const seen = page.locator('#seen-on');
    const panel = seen.locator('[data-seen-panel]');
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('data-page', 'home');
    await expect(panel).toHaveAttribute('data-device', 'desktop');
    // Every section on the capture carries a pinned tag.
    expect(await panel.locator('.fp__region').count()).toBeGreaterThan(3);
    await expect(panel.locator('.fp__tag').first()).toBeAttached();

    await seen.locator('.seen__tabs a', { hasText: 'Collection' }).click();
    await page.waitForURL(/page=collection/);
    await expect(panel).toHaveAttribute('data-page', 'collection');
    await expect(seen.locator('.seen__tabs a[aria-current="page"]')).toHaveText('Collection');

    const mobile = seen.locator('.seen__device a', { hasText: 'Mobile' });
    await expect(mobile).toHaveAttribute('href', /page=collection&device=mobile#seen-on$/);
    await mobile.click();
    await page.waitForURL(/device=mobile/);
    await expect(panel).toHaveAttribute('data-device', 'mobile');
    await expect(panel).toHaveAttribute('data-page', 'collection');
    const img = panel.locator('.fp__canvas > img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', /collection page.*mobile/);
    // The capture links to the store page at the same page type and device.
    await expect(panel.locator('.seen__open')).toHaveAttribute(
      'href',
      /\/stores\/[^?]+\?page=collection&device=mobile/,
    );
  });

  test('capture state works from the URL without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/themes/prestige?page=product&device=mobile');
    const panel = page.locator('#seen-on [data-seen-panel]');
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('data-page', 'product');
    await expect(panel).toHaveAttribute('data-device', 'mobile');
    await expect(page.locator('.seen__tabs a[aria-current="page"]')).toHaveText('Product');
    await expect(page.locator('.seen__device a[aria-current="true"]')).toHaveText('Mobile');
    await context.close();
  });

  test('every detected store using the theme is listed and links to its page', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/prestige');
    const rows = page.locator('#stores tbody tr');
    // All detected stores (13), not only the curated one.
    await expect(rows).toHaveCount(13);
    await expect(page.locator('#stores .sh__count')).toHaveText('13');
    const hrefs = await rows
      .locator('a')
      .evaluateAll((els) => els.map((a) => a.getAttribute('href')));
    for (const href of hrefs) expect(href).toMatch(/^\/stores\/[a-z0-9.-]+$/);
    await expect(page.locator('#stores')).toContainText('Not captured');
  });

  test('apps used with the theme share ranks on equal usage', async ({ page }) => {
    await prepare(page);
    await page.goto('/themes/prestige');
    const ranks = await page.locator('.tapps__rank').allTextContents();
    expect(ranks[0]).toBe('#1');
    // Apps on the same number of Prestige stores share one rank (competition ranking: 1, 2, 2, 4).
    const { data } = (await (await page.request.get('/api/v1/themes/prestige')).json()) as {
      data: { top_apps: Array<{ stores: number }> };
    };
    const expected = data.top_apps.map(
      (a) => `#${data.top_apps.findIndex((b) => b.stores === a.stores) + 1}`,
    );
    expect(ranks).toEqual(expected);
  });
});
