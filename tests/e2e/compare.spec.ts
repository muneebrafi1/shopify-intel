import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Comparisons and alternatives. Runs at 390px and 1440px (see playwright.config.ts).
 * Only curated popular pairs have a /compare page (owner decision); every other pair is a 404.
 * Curated pairs used here: judgeme-vs-loox (apps, sections on both), judgeme-vs-yotpo (a Built
 * for Shopify yes/no row), dawn-vs-horizon (themes, curated stores on both), helpdesk-vs-zendesk
 * (apps without a visible section). judgeme-vs-klaviyo is two valid apps but not curated.
 */

const ROUTES = [
  '/compare',
  '/compare?kind=theme',
  '/compare/judgeme-vs-loox',
  '/compare/dawn-vs-horizon',
  '/compare/helpdesk-vs-zendesk',
  '/compare/judgeme-vs-yotpo',
  '/compare/dawn-vs-horizon?page=product&device=mobile',
  '/alternatives',
  '/alternatives?kind=app',
  '/alternatives?q=klav',
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
  test('a reversed curated pair 301s to the canonical order', async ({ request }) => {
    const res = await request.get('/compare/loox-vs-judgeme', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers()['location'] ?? '', 'http://x').pathname).toBe(
      '/compare/judgeme-vs-loox',
    );
  });

  test('a valid pair that is not curated is a 404', async ({ page, request }) => {
    await expectHealthyPage(page, '/compare/judgeme-vs-klaviyo', { status: 404 });
    // The direct URL explains itself like the picker does, with links to both apps.
    await expect(page.getByText(/no comparison page for/i)).toBeVisible();
    await expect(page.locator('main a[href="/apps/klaviyo"]').first()).toBeVisible();
    // Reversed, it is still a 404 (no redirect to a page that doesn't exist).
    const res = await request.get('/compare/klaviyo-vs-judgeme', { maxRedirects: 0 });
    expect(res.status()).toBe(404);
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

  test('the picker redirects a curated pair to its page without JS', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/compare?a=loox&b=judgeme');
    await expect(page).toHaveURL(/\/compare\/judgeme-vs-loox$/);
    await expect(page.locator('h1')).toContainText('Judge.me');
    await context.close();
  });

  test('the picker says plainly when a pair has no comparison page', async ({ page }) => {
    await expectHealthyPage(page, '/compare?a=judgeme&b=klaviyo', { status: 404 });
    const answer = page.getByRole('status');
    await expect(answer).toContainText('There’s no comparison page for Judge.me and Klaviyo');
    await expect(answer).not.toContainText(/couldn.t find/i);
    // Both individual pages are offered, plus comparisons that do exist.
    await expect(answer.locator('a[href="/apps/judgeme"]')).toBeVisible();
    await expect(answer.locator('a[href="/apps/klaviyo"]')).toBeVisible();
    await expect(answer.locator('a[href="/compare/judgeme-vs-loox"]')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('the picker explains a mixed pick', async ({ page }) => {
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

  test('the searchable picker filters, lists curated partners first and submits', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/compare');
    await expect(page.locator('form[data-picker][data-ready]')).toHaveCount(1);
    const first = page.getByRole('combobox', { name: 'Compare' });
    await first.fill('judge');
    const list = page.getByRole('listbox', { name: 'Compare' });
    await expect(list.getByRole('option', { name: /Judge\.me/ })).toBeVisible();
    await expect(list.getByRole('option', { name: /Klaviyo/ })).toHaveCount(0);
    await first.press('Enter');
    await expect(page.locator('#picker-a')).toHaveValue('judgeme');
    // Focus moves on to the other side, which lists Judge.me's curated partners first.
    const second = page.getByRole('combobox', { name: 'With' });
    await expect(second).toBeFocused();
    const partners = page.getByRole('listbox', { name: 'With' });
    await expect(partners).toContainText('Compared with Judge.me');
    await expect(partners.getByRole('option').first()).toContainText(/Loox|Yotpo/);
    // Themes are not offered next to an app.
    await expect(partners.getByRole('option', { name: /Dawn/ })).toHaveCount(0);
    await second.fill('loox');
    await second.press('Enter');
    await expect(page.locator('#picker-b')).toHaveValue('loox');
    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page).toHaveURL(/\/compare\/judgeme-vs-loox$/);
  });

  test('every pair on the index has a page', async ({ page, request }) => {
    await prepare(page);
    await page.goto('/compare');
    const hrefs = await page
      .locator('.pcard a[href^="/compare/"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs.slice(0, 12)) {
      const res = await request.get(href, { maxRedirects: 0 });
      expect(res.status(), href).toBe(200);
    }
  });
});

test.describe('compare page behaviour', () => {
  test('the fact matrix shows ticks and dashes, never a winner', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/judgeme-vs-yotpo');
    const table = page.locator('.fm__table');
    await expect(table.locator('.fm__cell--yes').first()).toBeVisible();
    await expect(table.locator('.fm__cell--no').first()).toBeVisible();
    // Built for Shopify: Judge.me yes, Yotpo no.
    const bfs = table.locator('tr', { has: page.locator('th', { hasText: 'Built for Shopify' }) });
    await expect(bfs.locator('td').nth(0)).toHaveClass(/fm__cell--yes/);
    await expect(bfs.locator('td').nth(1)).toHaveClass(/fm__cell--no/);
    await expect(bfs.locator('td').nth(0)).toContainText('Yes');
    await expect(table.locator('[class*="winner"]')).toHaveCount(0);
    // Every row explains itself in one line.
    await expect(bfs.locator('.fm__help')).toBeVisible();
  });

  test('the stage switches device in place and keeps the URL shareable', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/dawn-vs-horizon');
    const stage = page.locator('#stage');
    await expect(stage.locator('[data-stage-frame="home:desktop"]')).toBeVisible();
    // Sections are pinned on the captures.
    await expect(
      stage.locator('[data-stage-frame="home:desktop"] .seen__region').first(),
    ).toBeAttached();
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
    await page.goto('/compare/dawn-vs-horizon?page=product&device=mobile');
    await expect(page.locator('[data-stage-frame="product:mobile"]')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/compare\/dawn-vs-horizon$/,
    );
  });

  test('app captures carry a pinned section tag', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/judgeme-vs-loox');
    const frame = page.locator('#stage [data-stage-frame]:not([hidden])');
    await expect(frame.locator('.seen__tag--crop').first()).toContainText('Judge.me');
    await expect(frame.locator('.seen__tag--crop').nth(1)).toContainText('Loox');
  });

  test('the compact bar appears once both products scroll away', async ({ page }) => {
    await prepare(page);
    await page.goto('/compare/judgeme-vs-loox');
    const bar = page.locator('[data-cbar]');
    await expect(bar).not.toHaveClass(/is-shown/);
    await page.locator('#facts').scrollIntoViewIfNeeded();
    await expect(bar).toHaveClass(/is-shown/);
    const box = await bar.boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(52);
  });

  test('on a phone the plans show one side at a time', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 768, 'side by side on wide screens');
    await prepare(page);
    await page.goto('/compare/judgeme-vs-loox');
    const plans = page.locator('#pricing');
    await expect(plans.locator('.dip__side--a')).toBeVisible();
    await expect(plans.locator('.dip__side--b')).toBeHidden();
    await plans.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Loox' }).click();
    await expect(plans.locator('.dip__side--b')).toBeVisible();
    await expect(plans.locator('.dip__side--a')).toBeHidden();
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

  test('"Compare" only links curated pairs; others link the app page', async ({
    page,
    request,
  }) => {
    await prepare(page);
    await page.goto('/alternatives/klaviyo');
    // Omnisend is an alternative but Klaviyo vs Omnisend is not a curated comparison.
    await expect(page.locator('a[href="/compare/klaviyo-vs-omnisend"]')).toHaveCount(0);
    const omnisend = page.locator('.alt', {
      has: page.locator('.alt__name', { hasText: 'Omnisend' }),
    });
    await expect(omnisend.locator('.alt__action a[href="/apps/omnisend"]')).toBeVisible();
    // Every compare link on the page resolves to a real comparison.
    const hrefs = await page
      .locator('a[href^="/compare/"]')
      .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('href')!))]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const res = await request.get(href, { maxRedirects: 0 });
      expect(res.status(), href).toBe(200);
    }
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

  test('the index searches by name', async ({ page }) => {
    await prepare(page);
    await page.goto('/alternatives?q=klav');
    await expect(page.locator('a[href="/alternatives/klaviyo"]')).toBeVisible();
    await expect(page.locator('a[href="/alternatives/judgeme"]')).toHaveCount(0);
    await expect(page.locator('a[href="/alternatives/dawn"]')).toHaveCount(0);
  });
});
