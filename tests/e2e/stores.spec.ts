import { expect, test, type Page } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * /stores (curated grid, detected index, filters, paging) and /stores/<domain> (the specimen:
 * plates viewer, stack, similar stores, removal link; the not-captured state; 404s).
 * Runs at 390px and 1440px (playwright.config.ts).
 */

const total = async (page: Page) => {
  const text = (await page.locator('.fbar__total').first().textContent()) ?? '';
  return Number(text.replace(/[^\d]/g, ''));
};

test.describe('stores index', () => {
  for (const path of [
    '/stores',
    '/stores?view=index',
    '/stores?theme=prestige',
    '/stores?sort=apps&view=index',
    '/stores?capture=captured',
  ]) {
    test(`healthy: ${path}`, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('default view is the curated capture grid', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores');
    const cards = page.locator('.stores__grid .store-card');
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(page.locator('.seg__item[aria-current="true"]').first()).toContainText('Curated');
    await expect(page.locator('.rest')).toContainText('No screenshots yet');
  });

  test('index view lists every detected store', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?view=index');
    expect(await total(page)).toBe(930);
    await expect(page.locator('[data-store-index] .irow')).toHaveCount(60);
    await expect(page.locator('[data-store-index] .irow__n').first()).toHaveText('N°001');
  });

  test('a theme filter narrows the list to that theme', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?theme=prestige');
    const n = await total(page);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(930);
    const rows = page.locator('[data-store-index] .irow');
    await expect(rows).toHaveCount(n);
    for (const text of await rows.allTextContents()) expect(text).toContain('Prestige');
    // The active filter is shown as a removable chip that clears it.
    await expect(page.locator('.fbar__active a').first()).toHaveAttribute('href', '/stores');
  });

  test('load more appends the next page of the index', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?view=index');
    const more = page.locator('a[data-load-more]');
    await expect(more).toHaveAttribute('href', /cursor=.+&p=2/);
    await more.click();
    await expect(page.locator('[data-store-index] .irow')).toHaveCount(120);
    await expect(page.locator('[data-store-index] .irow__n').nth(60)).toHaveText('N°061');
  });

  test('the second page also works without JavaScript', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?view=index');
    const href = await page.locator('a[data-load-more]').getAttribute('href');
    await page.goto(href!);
    await expect(page.locator('[data-store-index] .irow__n').first()).toHaveText('N°061');
  });

  test('an empty filter result explains itself', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?capture=captured');
    await expect(page.locator('.empty')).toContainText('No stores match');
  });
});

test.describe('store detail', () => {
  test('healthy: curated store', async ({ page }) => {
    await expectHealthyPage(page, '/stores/youngla.com');
    await expect(page.locator('h1')).toHaveText('YoungLA');
    await expect(page.locator('.shdr__label')).toContainText('N°001');
  });

  for (const path of [
    '/stores/youngla.com?page=product&device=mobile',
    '/stores/thesill.com?page=cart',
    '/stores/eatfishwife.com?page=collection&device=mobile',
  ]) {
    test(`healthy: ${path}`, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('header links: visit store (not affiliate) and removal request', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    const visit = page.locator('a.shdr__visit');
    await expect(visit).toHaveAttribute('rel', 'noopener');
    await expect(visit).toHaveAttribute('href', /^https:\/\/(www\.)?youngla\.com/);
    await expect(page.locator('a[href="/opt-out?domain=youngla.com"]')).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.join('')).toContain('BreadcrumbList');
    expect(ld.join('')).toContain('OnlineStore');
  });

  test('page tabs and the device toggle change the viewer', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    await expect(page.locator('.plates__viewer .fp__canvas > img')).toHaveAttribute(
      'alt',
      /home page on desktop/,
    );
    await expect(page.locator('.plates__status')).toContainText('Layout preview — capture pending');

    await page.locator('.plates__tabs a', { hasText: 'Product' }).click();
    await expect(page).toHaveURL(/[?&]page=product/);
    await expect(page.locator('.plates__viewer .fp__canvas > img')).toHaveAttribute(
      'alt',
      /product page on desktop/,
    );

    await page.locator('.plates__top a', { hasText: 'Mobile' }).click();
    await expect(page).toHaveURL(/page=product&device=mobile/);
    await expect(page.locator('.plates__viewer')).toHaveClass(/fp--mobile/);
    await expect(page.locator('.plates__frame')).toContainText('06');

    // The contact strip switches plates too.
    await page.locator('.strip__item').first().locator('a').click();
    await expect(page.locator('.plates__viewer .fp__canvas > img')).toHaveAttribute(
      'alt',
      /home page on desktop/,
    );
  });

  test('rail items scroll the capture to their section', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    const item = page.locator('.plates__viewer .fp__item', { hasText: 'Reviews' }).first();
    const id = await item.getAttribute('data-target');
    await item.click();
    await expect(page.locator(`#section-${id}`)).toBeInViewport();
    await expect(page).toHaveURL(new RegExp(`#section-${id}$`));
  });

  test('stack placements link to the section on the right plate', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    const jump = page.locator('.stack__jump', { hasText: 'Reviews on the product page' });
    const href = await jump.getAttribute('href');
    expect(href).toMatch(/^\/stores\/youngla\.com\?page=product#section-\d+$/);
    await jump.click();
    await expect(page).toHaveURL(/page=product#section-\d+$/);
    await expect(page.locator(href!.slice(href!.indexOf('#')))).toBeInViewport();
  });

  test('uncaptured store: honest state, still useful, not indexed', async ({ page }) => {
    await expectHealthyPage(page, '/stores/muji.ca');
    await expect(page.locator('.nc')).toContainText('Not captured yet');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('.stack__app').first()).toBeVisible();
    await expect(page.locator('a[href="/opt-out?domain=muji.ca"]')).toBeVisible();
    await expect(page.locator('#plates')).toHaveCount(0);
  });

  test('unknown domain is a 404', async ({ page }) => {
    await expectHealthyPage(page, '/stores/not-a-real-store.example', { status: 404 });
  });

  test('non-canonical domain redirects to the store page', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/WWW.YoungLA.com?page=cart');
    await expect(page).toHaveURL(/\/stores\/youngla\.com\?page=cart$/);
  });
});
