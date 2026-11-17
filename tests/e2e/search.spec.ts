import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/** Full search results page (/search?q=&type=). Runs at 390px and 1440px. */

const ROUTES = [
  '/search',
  '/search?q=judge',
  '/search?q=pre',
  '/search?q=re',
  '/search?q=re&type=app',
  '/search?q=pre&type=bogus',
  '/search?q=zzzzzz',
  '/search?q=%22%3Cb%3E',
];

test.describe('search pages are healthy', () => {
  for (const path of ROUTES) {
    test(path, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }
});

test.describe('search results', () => {
  test('/search?q=judge lists Judge.me in the apps group', async ({ page }) => {
    await prepare(page);
    await page.goto('/search?q=judge');
    await expect(page.locator('h1')).toContainText('Results for “judge”');
    // The query stays in the large field.
    await expect(page.locator('#search-q')).toHaveValue('judge');
    const apps = page.locator('#results-app');
    await expect(apps).toBeVisible();
    const link = apps.getByRole('link', { name: /Judge\.me/ }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/apps/judgeme');
    // The matched word start is marked.
    await expect(link.locator('mark')).toHaveText(/judge/i);
  });

  test('tabs by result type carry counts and filter the list', async ({ page }) => {
    await prepare(page);
    await page.goto('/search?q=re');
    const tabs = page.getByRole('navigation', { name: 'Result types' });
    const all = tabs.getByRole('link', { name: /^All/ });
    await expect(all).toHaveAttribute('aria-current', 'page');
    await expect(all.locator('.tabs__count')).toHaveText(/^\d+\+?$/);
    const appsTab = tabs.getByRole('link', { name: /^Apps/ });
    await expect(appsTab.locator('.tabs__count')).toHaveText('20+');

    // "All" shows the first rows of each kind, with a way to see the rest.
    const appRows = page.locator('#results-app .hit');
    await expect(appRows).toHaveCount(5);
    await expect(page.locator('#results-app .rgroup__all')).toHaveAttribute(
      'href',
      '/search?q=re&type=app',
    );
    expect(await page.locator('.rgroup').count()).toBeGreaterThan(1);

    await appsTab.click();
    await page.waitForURL(/\/search\?q=re&type=app$/);
    await expect(
      page.getByRole('navigation', { name: 'Result types' }).getByRole('link', { name: /^Apps/ }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.rgroup')).toHaveCount(1);
    await expect(page.locator('#results-app .hit')).toHaveCount(20);
    await expect(page.locator('#results-app .rgroup__foot')).toContainText('first 20');
  });

  test('an unknown type falls back to every kind', async ({ page }) => {
    await prepare(page);
    await page.goto('/search?q=pre&type=bogus');
    await expect(
      page.getByRole('navigation', { name: 'Result types' }).getByRole('link', { name: /^All/ }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await page.locator('.rgroup').count()).toBeGreaterThan(1);
  });

  test('result rows have a picture, a subtitle and an action', async ({ page }) => {
    await prepare(page);
    await page.goto('/search?q=pre');
    const row = page.locator('#results-theme .hit__link').first();
    await expect(row.locator('.hit__media img')).toHaveAttribute('alt', '');
    await expect(row.locator('.hit__sub')).toContainText(/\S/);
    await expect(row.locator('.hit__action')).toContainText(/View theme/);
    const box = await row.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('queries are noindex with a clean canonical', async ({ page }) => {
    await prepare(page);
    await page.goto('/search?q=judge');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/search$/);
  });

  test('no results shows the empty state with ways out', async ({ page }) => {
    await prepare(page);
    await page.goto('/search?q=zzzzzz');
    const empty = page.locator('.empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Nothing matches “zzzzzz”');
    await expect(empty.getByRole('link', { name: 'Browse themes' })).toHaveAttribute(
      'href',
      '/themes',
    );
    await expect(page.getByRole('heading', { name: /popular instead/i })).toBeVisible();
    const pill = page.locator('.srch__popular .srch__pills a').first();
    await expect(pill).toHaveAttribute('href', /^\/search\?q=[^&]+$/);
    // No tabs when there is nothing to filter.
    await expect(page.getByRole('navigation', { name: 'Result types' })).toHaveCount(0);
  });

  test('an empty query shows popular searches and picks', async ({ page }) => {
    await prepare(page);
    await page.goto('/search');
    await expect(page.locator('h1')).toHaveText('Search');
    await expect(page.locator('#results-theme')).toContainText('Prestige');
    await expect(page.locator('#results-store .hit').first()).toBeVisible();
    const pills = page.locator('.srch__start .srch__pills a');
    expect(await pills.count()).toBeGreaterThanOrEqual(4);
    await pills.first().click();
    await page.waitForURL(/\/search\?q=/);
    await expect(page.locator('h1')).toContainText('Results for');
  });

  test('the form searches without JS and keeps the selected tab', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/search');
    await page.locator('#search-q').fill('loox');
    await page.locator('#search-q').press('Enter');
    await page.waitForURL(/\/search\?q=loox$/);
    await expect(page.locator('#results-app')).toContainText('Loox');

    await page.goto('/search?q=re&type=app');
    await page.locator('#search-q').fill('loox');
    await page.locator('#search-q').press('Enter');
    await page.waitForURL(/\/search\?q=loox&type=app$/);
    await expect(page.locator('#results-app')).toContainText('Loox');
    await context.close();
  });
});
