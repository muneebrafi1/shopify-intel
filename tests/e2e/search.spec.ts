import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/** Full search results page (/search?q=). Runs at 390px and 1440px. */

const ROUTES = [
  '/search',
  '/search?q=judge',
  '/search?q=pre',
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
    const apps = page.locator('#results-app');
    await expect(apps).toBeVisible();
    const link = apps.getByRole('link', { name: /Judge\.me/ }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/apps/judgeme');
    // The matched word start is marked.
    await expect(link.locator('mark')).toHaveText(/judge/i);
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
  });

  test('an empty query shows popular picks', async ({ page }) => {
    await prepare(page);
    await page.goto('/search');
    await expect(page.locator('h1')).toHaveText('Search');
    await expect(page.locator('#results-theme')).toContainText('Prestige');
    await expect(page.locator('#results-store .hit').first()).toBeVisible();
  });

  test('the form searches without JS', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/search');
    await page.locator('#search-q').fill('loox');
    await page.locator('#search-q').press('Enter');
    await page.waitForURL(/\/search\?q=loox/);
    await expect(page.locator('#results-app')).toContainText('Loox');
    await context.close();
  });
});
