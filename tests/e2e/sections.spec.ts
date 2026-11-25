import { expect, test, type Page } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Sections library: /sections, /sections/<type>, /sections/<type>/<id>.
 * Runs at 390px and 1440px (see playwright.config.ts) against the seeded data.
 */

const CARD_LINKS = '[data-sgrid-cards] [data-ccard-link]';
const isDesktop = (name: string) => name.startsWith('desktop');

/** A real section id of a type, read from the type page's first card. */
async function firstSectionHref(page: Page, type: string) {
  await prepare(page);
  await page.goto(`/sections/${type}`);
  const href = await page.locator(CARD_LINKS).first().getAttribute('href');
  expect(href).toMatch(new RegExp(`^/sections/${type}/\\d+$`));
  return href!;
}

test.describe('sections pages are healthy', () => {
  for (const path of [
    '/sections',
    '/sections?device=mobile',
    '/sections?page=product&device=desktop',
    '/sections?view=index',
    '/sections?sort=store',
    '/sections?q=zzzz-nothing-matches',
    '/sections/reviews',
    '/sections/reviews?device=mobile',
    '/sections/reviews?view=index',
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

  test('section detail with a long crop', async ({ page }) => {
    const href = await firstSectionHref(page, 'product-grid');
    await expectHealthyPage(page, href);
  });

  test('unknown types and ids are 404s', async ({ page }) => {
    await expectHealthyPage(page, '/sections/no-such-type', { status: 404 });
    await prepare(page);
    for (const path of [
      '/sections/reviews/999999999',
      '/sections/reviews/abc',
      '/sections/reviews/0',
    ]) {
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
  test('the overview shows every type with a crop, only on the plain library', async ({ page }) => {
    await prepare(page);
    // One card per section type that has at least one section (placeholder or captured).
    const types = (await (await page.request.get('/api/v1/section-types')).json()) as {
      data: { items: Array<{ count: number }> };
    };
    const withSections = types.data.items.filter((t) => t.count > 0).length;
    expect(withSections).toBeGreaterThan(20);
    await page.goto('/sections');
    const cards = page.locator('.tov__grid .tcard');
    await expect(cards).toHaveCount(withSections);
    await expect(cards.first().locator('img')).toHaveCount(1);
    await expect(page.locator('.tov__grid a[href="/sections/reviews"]')).toHaveCount(1);
    await page.goto('/sections?device=mobile');
    await expect(page.locator('.tov__grid')).toHaveCount(0);
  });

  test('a type pill / the filter sheet narrows the grid', async ({ page }, info) => {
    await prepare(page);
    await page.goto('/sections');
    const all = Number(await page.locator('[data-sgrid]').getAttribute('data-total'));
    if (isDesktop(info.project.name)) {
      await page.locator('.fbar__pills a', { hasText: /^Reviews/ }).click();
    } else {
      await page.getByRole('button', { name: /Filters/ }).click();
      await page.locator('#filter-sheet a', { hasText: /^Reviews/ }).click();
    }
    await expect(page).toHaveURL(/\/sections\/reviews$/);
    const narrowed = Number(await page.locator('[data-sgrid]').getAttribute('data-total'));
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);
    await expect(page.locator('h1')).toContainText('Reviews');
    // The selected pill is marked and scrolled into view.
    const current = page.locator('.fbar__pills a[aria-current="true"]');
    await expect(current).toContainText('Reviews');
    await expect(current).toBeInViewport();
    const hrefs = await page
      .locator(CARD_LINKS)
      .evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h.startsWith('/sections/reviews/'))).toBe(true);
  });

  test('the device switch keeps only that device, and links keep each other', async ({ page }) => {
    await prepare(page);
    await page.goto('/sections');
    await page
      .getByRole('group', { name: 'Device' })
      .getByRole('link', { name: /Mobile/ })
      .click();
    await expect(page).toHaveURL(/\/sections\?device=mobile$/);
    await expect(
      page.getByRole('group', { name: 'Device' }).locator('[aria-current="true"]'),
    ).toContainText('Mobile');
    const cards = page.locator('[data-sgrid-cards] > .ccard');
    await expect(cards.first()).toBeVisible();
    const classes = await cards.evaluateAll((els) => els.map((el) => el.className));
    expect(classes.every((c) => c.includes('ccard--mobile'))).toBe(true);
    // Mobile-only results use portrait wells.
    await expect(page.locator('[data-sgrid-cards]')).toHaveClass(/sgrid__cards--portrait/);
    // Filters are links that keep each other.
    await expect(page.locator('.fbar__pills a[href^="/sections/reviews"]').first()).toHaveAttribute(
      'href',
      '/sections/reviews?device=mobile',
    );
  });

  test('search resolves to a type, an app or a store, and says when nothing matches', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/sections?device=mobile');
    const box = page.getByRole('searchbox', { name: /Search type/ });
    await box.fill('reviews');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/sections\/reviews\?device=mobile$/);
    await page.waitForLoadState('load');

    await page.goto('/sections?q=loox');
    await expect(page).toHaveURL(/\/sections\?app=loox$/);
    await expect(page.locator('.fbar__active')).toContainText('App: Loox');

    await page.goto('/sections?q=zzzz-nothing-matches');
    await expect(page.locator('.lib__results')).toContainText('Nothing in the library matches');
    await expect(page.locator('.lib__results a[href^="/search?q="]')).toHaveCount(1);
  });

  test('list view is a table of the same sections', async ({ page }) => {
    await prepare(page);
    await page.goto('/sections/reviews?view=index');
    const rows = page.locator('[data-sgrid] tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(24);
    await expect(rows.first().locator('[data-ccard-link]')).toHaveAttribute(
      'href',
      /^\/sections\/reviews\/\d+$/,
    );
  });

  test('"Load more" appends the next page in place', async ({ page }) => {
    await prepare(page);
    await page.goto('/sections');
    const cards = page.locator('[data-sgrid-cards] > .ccard');
    const before = await cards.count();
    const more = page.locator('[data-sgrid-more]');
    await expect(more).toHaveAttribute('href', /cursor=.+&p=2/);
    await more.click();
    await expect(cards).toHaveCount(before * 2);
    await expect(page).toHaveURL(/\/sections$/);
    await expect(more).toHaveAttribute('href', /p=3/);
    const ids = await cards.evaluateAll((els) =>
      els.map((el) => el.querySelector('[data-ccard-link]')?.getAttribute('href')),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('"Load more" keeps the sort', async ({ page }) => {
    await prepare(page);
    await page.goto('/sections?sort=store');
    await expect(page.locator('[data-sgrid-more]')).toHaveAttribute('href', /sort=store/);
    await page.goto((await page.locator('[data-sgrid-more]').getAttribute('href'))!);
    await expect(page.locator('[data-sgrid-status]')).toContainText('Sections 25–');
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

test.describe('section type page', () => {
  test('says what renders it, and names filter the grid', async ({ page }) => {
    await prepare(page);
    await page.goto('/sections/reviews');
    const block = page.locator('section[aria-labelledby="rendered-by"]');
    await expect(block).toContainText('Apps');
    await expect(block).toContainText('Themes');
    const appLink = block.locator('a.rby__name[href*="app="]').first();
    const href = (await appLink.getAttribute('href'))!;
    expect(href).toMatch(/^\/sections\/reviews\?app=[a-z0-9-]+$/);
    await appLink.click();
    await expect(page).toHaveURL(new RegExp(`${href.replace('?', '\\?')}$`));
    await expect(page.locator('.fbar__active')).toContainText('App:');
    // Other types in the same group, with a crop each.
    await page.goto('/sections/reviews');
    await expect(
      page.locator('section[aria-labelledby="related-types"] .tcard').first(),
    ).toBeVisible();
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
      new RegExp(
        `^/stores/[^?]+\\?page=(home|collection|product|cart)&device=(desktop|mobile)#section-${id}$`,
      ),
    );
    // Facts: the store, its theme (with the detected version when known) and the page.
    const facts = page.locator('.fcard');
    await expect(facts).toContainText('Store');
    await expect(facts).toContainText('Theme');
    await expect(facts).toContainText('Page type');

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
  });

  test('the section is outlined on its full page, with the page’s other sections', async ({
    page,
  }) => {
    const href = await firstSectionHref(page, 'reviews');
    const id = href.split('/').pop()!;
    await page.goto(href);
    const ctx = page.locator(`[data-ctx="${id}"]`);
    await expect(ctx.locator(`.fp__region[data-region="${id}"]`)).toHaveCount(1);
    // This section is marked in the list and links to itself.
    await expect(ctx.locator('.ctx__row[aria-current="page"]')).toHaveAttribute('href', href);
    // The map starts scrolled to it.
    const visible = await ctx.evaluate((root, sid) => {
      const scroller = root.querySelector<HTMLElement>('[data-ctx-scroll]')!;
      const region = root.querySelector<HTMLElement>(`.fp__region[data-region="${sid}"]`)!;
      const a = scroller.getBoundingClientRect();
      const b = region.getBoundingClientRect();
      return b.top < a.bottom && b.bottom > a.top;
    }, id);
    expect(visible).toBe(true);
  });

  test('grid clicks open a lightbox with its own URL; keys, focus and Esc work', async ({
    page,
  }, info) => {
    await prepare(page);
    await page.goto('/sections/reviews');
    const first = page.locator(CARD_LINKS).first();
    const href = (await first.getAttribute('href'))!;
    await first.click();
    const dialog = page.locator('[data-lb]');
    await expect(dialog.locator('[data-section-focus]')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator('h1')).toHaveCount(1);

    if (isDesktop(info.project.name)) {
      await page.keyboard.press('ArrowRight');
    } else {
      // Below 768px it is a full-screen sheet with prev/next in a bottom bar.
      const box = await dialog.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(389);
      expect(box?.height).toBeGreaterThanOrEqual(840);
      await dialog.locator('.lb__foot [data-lb-next]').click();
    }
    await expect(dialog.locator('[data-lb-pos]')).toHaveText('2');
    await expect(page).not.toHaveURL(new RegExp(`${href}$`));

    // Focus stays inside the dialog.
    for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-lb]'))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/sections\/reviews$/);
    // Focus returns to the card that opened it.
    await expect(first).toBeFocused();
  });
});
