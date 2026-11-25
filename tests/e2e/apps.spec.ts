import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Apps area: index (ranking table + grid of pinned captures), categories, category pages and
 * the app detail view ("Seen on" stage, facts card, plans, stores, alternatives). Runs at 390px
 * and 1440px (see playwright.config.ts).
 */

const ROUTES = [
  '/apps',
  '/apps?view=grid',
  '/apps?category=reviews&sort=rating',
  '/apps?q=reviews',
  '/apps?q=zzzz-no-such-app',
  '/apps?p=2',
  '/apps/categories',
  '/apps/categories/reviews',
  '/apps/categories/reviews?device=mobile',
  '/apps/categories/analytics',
  '/apps/categories/privacy-and-security',
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

/** Rank number shown in a row ("#2" → 2). */
const rankOf = (text: string) => Number(text.trim().replace(/^#/, ''));
/** Store count shown in a row ("1,234 stores" → 1234). */
const storesOf = (text: string) => Number(text.replace(/[^\d]/g, ''));

test.describe('apps index', () => {
  test('ranks come from usage: equal usage shares a rank (1, 2, 2, 4)', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps');
    const ranks = (await page.locator('.rrow__rank').allTextContents()).map(rankOf);
    const stores = (await page.locator('.rrow__stores').allTextContents()).map(storesOf);
    expect(ranks.length).toBeGreaterThan(20);
    expect(ranks[0]).toBe(1);
    // Page 1 sorted by use holds every app ranked above any of its rows.
    stores.forEach((s, i) => expect(ranks[i]).toBe(1 + stores.filter((o) => o > s).length));
    // There are ties in the data, so some rank repeats.
    expect(new Set(ranks).size).toBeLessThan(ranks.length);
    await expect(page.locator('.rrow__rank').first()).toHaveText('#1');
  });

  test('category filter narrows the rows and ranks within the category', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps');
    const all = await page.locator('.rrow').count();
    expect(all).toBeGreaterThan(20);

    await page.goto('/apps?category=reviews');
    const rows = page.locator('.rrow');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(all);
    for (const cat of await page.locator('.rrow__cat').allTextContents())
      expect(cat).toContain('Reviews');
    await expect(page.locator('.fbar__total')).toContainText(`${n} apps`);
    await expect(page.locator('.fbar__pills [aria-current="true"]')).toContainText('Reviews');
    await expect(page.locator('.rrow__rank').first()).toHaveText('#1');
    // The category context card links to the category page.
    await expect(page.locator('.catctx a[href="/apps/categories/reviews"]')).toBeVisible();
  });

  test('category pills keep the other URL state', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps?sort=rating');
    await page.locator('.fbar__pills a', { hasText: 'Subscriptions' }).click();
    await expect(page).toHaveURL(/category=subscriptions/);
    await expect(page).toHaveURL(/sort=rating/);
  });

  test('search narrows the list and keeps filters', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps?sort=rating');
    const box = page.locator('.fbar__search input[type="search"]');
    await box.fill('reviews');
    await box.press('Enter');
    await expect(page).toHaveURL(/q=reviews/);
    await expect(page).toHaveURL(/sort=rating/);
    const n = await page.locator('.rrow').count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(30);

    await page.goto('/apps?q=zzzz-no-such-app');
    await expect(page.locator('.empty')).toContainText('No apps match');
  });

  test('grid view pins each app’s section and lists apps without one', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps?view=grid');
    const card = page.locator('.capcard').first();
    await expect(card).toBeVisible();
    await expect(card.locator('.pin img')).toHaveAttribute('src', /\/media\//);
    await expect(card.locator('.pin__tag')).toBeVisible();
    await expect(page.locator('.plain').first()).toBeVisible();
  });

  test('pagination reaches the end of the ranking', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps?p=2');
    await expect(page.locator('.pager__status')).toContainText('61–');
  });

  test('category cards link to their category pages', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps');
    const cards = page.locator('.apps__cats .ccard');
    expect(await cards.count()).toBe(6);
    await expect(cards.first().locator('a.stretched-link')).toHaveAttribute(
      'href',
      /^\/apps\/categories\/[a-z-]+$/,
    );
  });
});

test.describe('app categories', () => {
  test('categories index lists every category as a card, split by where it lives', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/apps/categories');
    const cards = page.locator('.ccard');
    expect(await cards.count()).toBe(22);
    // Ordered by reach: Email & SMS leads the storefront group.
    await expect(cards.first()).toContainText('Email & SMS');
    await expect(page.locator('a[href="/apps/categories/reviews"]').first()).toBeVisible();
    await expect(page.locator('#behind-title')).toBeVisible();
    // Top apps carry their store counts.
    await expect(cards.first().locator('.ccard__app-stores').first()).toHaveText(/\d/);
  });

  test('category page ranks its apps by category rank and pins where they show up', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/apps/categories/reviews');
    await expect(page.locator('h1')).toContainText('Reviews');
    const ranks = (await page.locator('.rrow__rank').allTextContents()).map(rankOf);
    expect(ranks.length).toBeGreaterThan(2);
    expect(ranks[0]).toBe(1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    await expect(page.locator('a[href^="/compare/"]').first()).toBeAttached();
    const capture = page.locator('#where a[href*="#section-"]').first();
    await expect(capture).toHaveAttribute('href', /device=desktop#section-\d+$/);
    // Fixture: a reviews section. Real capture: whichever section carries a Judge.me block.
    await expect(page.locator('#where .pin__tag').first()).toContainText(/Reviews|Judge\.me/);
  });

  test('background categories say why there is nothing to pin', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/categories/privacy-and-security');
    await expect(page.locator('#where .empty')).toContainText('Nothing to pin');
  });
});

test.describe('app detail', () => {
  test('judge.me is a full app view', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/judgeme');
    await expect(page.locator('h1')).toHaveText('Judge.me');
    // Facts card: every fact from the listing and the scan, with its source and date.
    const facts = page.locator('.fcard');
    for (const label of [
      'Rating',
      'Price',
      'Free trial',
      'Stores',
      'Rank',
      'Category',
      'Category rank',
      'Developer',
      'Launched',
      'Built for Shopify',
      'Languages',
    ]) {
      await expect(facts.locator('dt', { hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
    }
    await expect(facts).toContainText('#2 overall');
    await expect(
      facts.locator('.facts__row', { hasText: 'Category rank' }).locator('dd'),
    ).toHaveText('#1');
    await expect(facts).toContainText('Free – $15/mo');
    await expect(facts).toContainText('Shopify App Store, checked 17 Nov 2026');
    // Seen on: captures link into the store viewer, anchored at the section.
    const plate = page.locator('#where a[href*="#section-"]').first();
    await expect(plate).toHaveAttribute(
      'href',
      /^\/stores\/[^?]+\?page=\w+&device=desktop#section-\d+$/,
    );
    // Fixture: a reviews section. Real capture: whichever section carries a Judge.me block.
    await expect(page.locator('#where .pin__tag').first()).toContainText(/Reviews|Judge\.me/);
    // Stores running it, plans, relationships.
    expect(await page.locator('#stores tbody tr').count()).toBe(24);
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

  test('compare links only point at curated pairs that have a page', async ({ page, request }) => {
    await prepare(page);
    await page.goto('/apps/judgeme');
    // Bazaarvoice is an alternative without a curated comparison: no compare link for it.
    await expect(page.locator('a[href="/compare/bazaarvoice-vs-judgeme"]')).toHaveCount(0);
    const hrefs = [
      ...new Set(
        await page
          .locator('a[href^="/compare/"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? '')),
      ),
    ];
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);
  });

  test('nothing links to the unmatched trustpilot app', async ({ page }) => {
    await prepare(page);
    for (const path of ['/apps', '/apps/categories', '/apps/categories/reviews', '/apps/judgeme']) {
      await page.goto(path);
      await expect(page.locator('a[href="/apps/trustpilot"]'), path).toHaveCount(0);
    }
  });

  test('the Seen on rail switches the pinned capture', async ({ page }) => {
    await prepare(page);
    await page.goto('/apps/judgeme');
    const items = page.locator('[data-seen-item]');
    expect(await items.count()).toBeGreaterThan(1);
    const second = items.nth(1);
    const id = await second.getAttribute('data-seen-item');
    await second.click();
    await expect(second).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(`[data-seen-panel="${id}"]`)).toBeVisible();
    await expect(page.locator('[data-seen-panel]:visible')).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`seen=${id}`));
    await expect(page.locator('[data-seen-open]')).toHaveAttribute('href', /#section-\d+$/);
    // Without JS the same link renders that capture on the server.
    await page.goto(`/apps/judgeme?seen=${id}`);
    await expect(page.locator(`[data-seen-panel="${id}"]`)).toBeVisible();
  });

  test('device toggle switches the captures to mobile', async ({ page }) => {
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
    await expect(cta).toContainText('Install on Shopify');
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
    await expect(page.locator('.fcard')).toContainText('Not checked yet');
    await expect(page.locator('.plan')).toHaveCount(0);
    await expect(page.locator('#stores tbody tr').first()).toBeVisible();
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
