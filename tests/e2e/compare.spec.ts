import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Comparisons and alternatives. Runs at 390px and 1440px (see playwright.config.ts).
 * Pairs: judgeme-vs-loox (apps, sections on both), dawn-vs-horizon (themes, curated stores on
 * both), helpdesk-vs-zendesk (apps without a visible section), judgeme-vs-klaviyo (a pair that
 * isn't in the popular list, with a Built for Shopify yes/no row).
 */

const ROUTES = [
  '/compare',
  '/compare?kind=theme',
  '/compare/judgeme-vs-loox',
  '/compare/dawn-vs-horizon',
  '/compare/helpdesk-vs-zendesk',
  '/compare/judgeme-vs-klaviyo',
  '/compare/dawn-vs-horizon?page=product&device=mobile',
  '/alternatives',
  '/alternatives?kind=app',
  '/alternatives/klaviyo',
  '/alternatives/prestige',
];

test.describe('compare and alternatives pages are healthy', () => {
  for (const path of ROUTES) {
    test(path, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }
});

test.describe('compare routing', () => {
  test('a reversed pair 301s to the canonical order', async ({ request }) => {
    const res = await request.get('/compare/loox-vs-judgeme', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers()['location'] ?? '', 'http://x').pathname).toBe(
      '/compare/judgeme-vs-loox',
    );
  });

  test('an unknown pair is a 404', async ({ page }) => {
    await expectHealthyPage(page, '/compare/judgeme-vs-not-an-app', { status: 404 });
  });

  test('an app and a theme together is a 404', async ({ page }) => {
    const res = await page.goto('/compare/dawn-vs-klaviyo');
    expect(res?.status()).toBe(404);
  });

  test('the same app twice is a 404', async ({ page }) => {
    const res = await page.goto('/compare/loox-vs-loox');
    expect(res?.status()).toBe(404);
  });

  test('"compare any two" redirects to the canonical pair without JS', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/compare?a=loox&b=judgeme');
    await expect(page).toHaveURL(/\/compare\/judgeme-vs-loox$/);
    await expect(page.locator('h1')).toContainText('Judge.me');
    await context.close();
  });

  test('"compare any two" explains a mixed pick', async ({ page }) => {
    await prepare(page);
    const res = await page.goto('/compare?a=klaviyo&b=dawn');
    expect(res?.status()).toBe(400);
    await expect(page.getByRole('alert')).toContainText('two apps or two themes');
  });

  test('picking a theme greys out apps in the other select', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare');
    await expect(page.locator('form[data-picker][data-ready]')).toHaveCount(1);
    await page.locator('#picker-a').selectOption('dawn');
    await expect(page.locator('#picker-b option[value="klaviyo"]')).toBeDisabled();
    await expect(page.locator('#picker-b option[value="horizon"]')).toBeEnabled();
    await page.locator('#picker-b').selectOption('horizon');
    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page).toHaveURL(/\/compare\/dawn-vs-horizon$/);
  });
});

test.describe('compare page behaviour', () => {
  test('the fact matrix shows ticks and crosses, never a winner', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/judgeme-vs-klaviyo');
    const table = page.locator('.fm__table');
    await expect(table.locator('.fm__cell--yes').first()).toBeVisible();
    await expect(table.locator('.fm__cell--no').first()).toBeVisible();
    // Built for Shopify: Judge.me yes, Klaviyo no.
    const bfs = table.locator('tr', { has: page.locator('th', { hasText: 'Built for Shopify' }) });
    await expect(bfs.locator('td').nth(0)).toHaveClass(/fm__cell--yes/);
    await expect(bfs.locator('td').nth(1)).toHaveClass(/fm__cell--no/);
    await expect(table.locator('[class*="winner"]')).toHaveCount(0);
  });

  test('the stage switches device in place and keeps the URL shareable', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/dawn-vs-horizon');
    const stage = page.locator('#stage');
    await expect(stage.locator('[data-stage-frame="home:desktop"]')).toBeVisible();
    const tabs = stage.getByRole('navigation', { name: 'Page type' });
    await stage
      .getByRole('group', { name: 'Device' })
      .getByRole('link', { name: 'Mobile' })
      .click();
    await expect(stage.locator('[data-stage-frame="home:mobile"]')).toBeVisible();
    await expect(stage.locator('[data-stage-frame="home:desktop"]')).toBeHidden();
    await expect(page).toHaveURL(/page=home&device=mobile/);
    await tabs.getByRole('link', { name: 'Product', exact: true }).click();
    await expect(stage.locator('[data-stage-frame="product:mobile"]')).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Product', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs.getByRole('link', { name: 'Home', exact: true })).not.toHaveAttribute(
      'aria-current',
      /.*/,
    );
  });

  test('the stage view comes from the query string', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/dawn-vs-horizon?page=cart&device=mobile');
    await expect(page.locator('[data-stage-frame="cart:mobile"]')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/compare\/dawn-vs-horizon$/,
    );
  });

  test('both items are in the JSON-LD item list', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/judgeme-vs-loox');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const list = ld.map((t) => JSON.parse(t)).find((x) => x['@type'] === 'ItemList');
    expect(list.itemListElement.map((i: { item: { name: string } }) => i.item.name)).toEqual([
      expect.stringContaining('Judge.me'),
      expect.stringContaining('Loox'),
    ]);
    expect(ld.map((t) => JSON.parse(t)['@type'])).toContain('BreadcrumbList');
  });
});

test.describe('alternatives', () => {
  test('Klaviyo lists Mailchimp or Omnisend, with a compare link to the canonical pair', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/alternatives/klaviyo');
    await expect(page.locator('h1')).toContainText('Klaviyo');
    const names = page.locator('.alt__name');
    await expect(names.filter({ hasText: /Mailchimp|Omnisend/ }).first()).toBeVisible();
    await expect(page.locator('a[href="/compare/klaviyo-vs-mailchimp"]').first()).toBeVisible();
    await expect(page.getByText('not a judgement of quality')).toBeVisible();
  });

  test('an unknown slug is a 404', async ({ page }) => {
    await expectHealthyPage(page, '/alternatives/not-an-app-or-theme', { status: 404 });
  });

  test('the index filters by kind', async ({ page }) => {
    await prepare(page);
    await page.goto('/alternatives?kind=theme');
    await expect(page.locator('#alti-themes')).toBeVisible();
    await expect(page.locator('#alti-apps')).toHaveCount(0);
  });
});
