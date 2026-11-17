import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Sections library: /sections, /sections/<type>, /sections/<type>/<id>.
 * Runs at 390px and 1440px (see playwright.config.ts) against the seeded data.
 */

/** A real section id of a type, read from the type page's first card. */
async function firstSectionHref(page: import('@playwright/test').Page, type: string) {
  await prepare(page);
  await page.goto(`/sections/${type}`);
  const href = await page.locator('[data-sgrid-cards] .section-card a.crop').first().getAttribute('href');
  expect(href).toMatch(new RegExp(`^/sections/${type}/\\d+$`));
  return href!;
}

test.describe('sections pages are healthy', () => {
  for (const path of [
    '/sections',
    '/sections?device=mobile',
    '/sections?page=product&device=desktop',
    '/sections/reviews',
    '/sections/reviews?device=mobile',
    '/sections/hero',
    '/sections/cart-summary',
    '/sections/reviews?theme=no-such-theme',
  ]) {
    test(path, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('section detail', async ({ page }) => {
    const href = await firstSectionHref(page, 'reviews');
    await expectHealthyPage(page, href);
  });

  test('unknown types and ids are 404s', async ({ page }) => {
    await expectHealthyPage(page, '/sections/no-such-type', { status: 404 });
    await prepare(page);
    for (const path of ['/sections/reviews/999999999', '/sections/reviews/abc', '/sections/reviews/0']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test('an id under the wrong type redirects to its real type', async ({ page }) => {
    const href = await firstSectionHref(page, 'reviews');
    const id = href.split('/').pop();
    const res = await page.request.get(`/sections/header/${id}`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toMatch(new RegExp(`/sections/reviews/${id}$`));
  });
});

test.describe('library browsing', () => {
  test('the type rail / type filter narrows the grid', async ({ page }, info) => {
    await prepare(page);
    await page.goto('/sections');
    const all = Number(await page.locator('[data-sgrid]').getAttribute('data-total'));
    if (info.project.name.startsWith('desktop')) {
      await page.locator('[data-toc] a', { hasText: /^Reviews/ }).click();
    } else {
      await page.getByRole('button', { name: /Filters/ }).click();
      await page.locator('#filter-sheet a', { hasText: /^Reviews/ }).click();
    }
    await expect(page).toHaveURL(/\/sections\/reviews$/);
    const narrowed = Number(await page.locator('[data-sgrid]').getAttribute('data-total'));
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);
    await expect(page.locator('h1')).toContainText('Reviews');
    const metas = await page.locator('[data-sgrid-cards] .section-card a.crop').evaluateAll((els) =>
      els.map((a) => a.getAttribute('href') ?? ''),
    );
    expect(metas.length).toBeGreaterThan(0);
    expect(metas.every((h) => h.startsWith('/sections/reviews/'))).toBe(true);
  });

  test('the device filter keeps only that device', async ({ page }) => {
    await prepare(page);
    await page.goto('/sections?device=mobile');
    const cards = page.locator('[data-sgrid-cards] .section-card .crop');
    await expect(cards.first()).toBeVisible();
    const classes = await cards.evaluateAll((els) => els.map((el) => el.className));
    expect(classes.every((c) => c.includes('crop--mobile'))).toBe(true);
    // Filters are links that keep each other.
    const reviews = page.locator('[data-toc] a[href^="/sections/reviews"], #filter-sheet a[href^="/sections/reviews"]').first();
    await expect(reviews).toHaveAttribute('href', '/sections/reviews?device=mobile');
  });

  test('"Load more" appends the next page in place', async ({ page }) => {
    await prepare(page);
    await page.goto('/sections');
    const cards = page.locator('[data-sgrid-cards] > .section-card');
    const before = await cards.count();
    const more = page.locator('[data-sgrid-more]');
    await expect(more).toHaveAttribute('href', /cursor=.+&p=2/);
    await more.click();
    await expect(cards).toHaveCount(before * 2);
    await expect(page).toHaveURL(/\/sections$/);
    await expect(more).toHaveAttribute('href', /p=3/);
    const ids = await cards.evaluateAll((els) => els.map((el) => el.querySelector('a')?.getAttribute('href')));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('"Load more" works without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/sections/reviews');
    await page.locator('[data-sgrid-more]').click();
    await expect(page).toHaveURL(/\/sections\/reviews\?cursor=.+&p=2/);
    await expect(page.locator('[data-sgrid-status]')).toContainText('Sections 25–');
    await expect(page.locator('[data-sgrid-first]')).toHaveAttribute('href', '/sections/reviews');
    await context.close();
  });
});

test.describe('section detail', () => {
  test('prev/next step through the type and "Open in full page" targets the store anchor', async ({
    page,
  }) => {
    const href = await firstSectionHref(page, 'reviews');
    const id = href.split('/').pop();
    await page.goto(href);

    const open = page.getByRole('link', { name: 'Open in full page' }).first();
    await expect(open).toHaveAttribute(
      'href',
      new RegExp(`^/stores/[^?]+\\?page=(home|collection|product|cart)&device=(desktop|mobile)#section-${id}$`),
    );

    const next = page.locator('[data-sf-next]');
    const nextHref = await next.getAttribute('href');
    expect(nextHref).toMatch(/^\/sections\/reviews\/\d+$/);
    await next.click();
    await expect(page).toHaveURL(new RegExp(`${nextHref}$`));
    await page.waitForLoadState('load');
    await expect(page.locator('[data-sf-prev]')).toHaveAttribute('href', href);

    // Arrow keys do the same.
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    // The page's other sections are listed, with this one marked.
    await expect(page.locator('[data-strip] .is-current a.crop')).toHaveAttribute('href', href);
  });

  test('grid clicks open a lightbox with its own URL (desktop)', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'Lightbox is a ≥768px enhancement');
    await prepare(page);
    await page.goto('/sections/reviews');
    const first = page.locator('[data-sgrid-cards] .section-card a.crop').first();
    const href = (await first.getAttribute('href'))!;
    await first.click();
    const dialog = page.locator('[data-lb]');
    await expect(dialog.locator('[data-section-focus]')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator('h1')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('[data-lb-pos]')).toHaveText('02');
    await expect(page).not.toHaveURL(new RegExp(`${href}$`));
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/sections\/reviews$/);
  });
});
