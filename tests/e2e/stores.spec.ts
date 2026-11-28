import { expect, test, type Page } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * /stores (curated grid by default, Curated / All detected scope, the stores table, filters,
 * search, paging) and /stores/<domain> (the viewer, facts, detected apps, similar stores,
 * removal link; the not-captured state; 404s). Runs at 390px and 1440px (playwright.config.ts).
 */

const total = async (page: Page) => {
  const text = (await page.locator('.fbar__total').first().textContent()) ?? '';
  return Number(text.replace(/[^\d]/g, ''));
};
const rows = (page: Page) => page.locator('[data-store-index] tbody tr');

interface ApiShot {
  is_placeholder: boolean;
  sections: Array<{ id: number; type: { name: string }; app: { short_name: string } | null }>;
}
interface ApiStore {
  apps: { total: number };
  pages: Array<{
    page_type: { slug: string };
    screenshots: { desktop: ApiShot | null; mobile: ApiShot | null };
  }>;
}
/** The store as the API sees it, so tests hold with placeholder fixtures or real captures. */
const storeDetail = async (page: Page, domain: string) =>
  ((await (await page.request.get(`/api/v1/stores/${domain}`)).json()) as { data: ApiStore }).data;
const homeShot = async (page: Page, domain: string) => {
  const home = (await storeDetail(page, domain)).pages.find((p) => p.page_type.slug === 'home');
  return home!.screenshots.desktop!;
};

test.describe('stores index', () => {
  for (const path of [
    '/stores',
    '/stores?view=index',
    '/stores?scope=all',
    '/stores?theme=prestige',
    '/stores?scope=all&sort=apps',
    '/stores?q=you',
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
    await expect(cards).toHaveCount(50);
    expect(await total(page)).toBe(50);
    const scope = page.locator('.stores__scope .seg__item');
    await expect(scope.first()).toHaveAttribute('aria-current', 'true');
    await expect(scope.first()).toContainText('Curated');
    await expect(scope.nth(1)).toContainText('930');
    await expect(scope.nth(1)).toHaveAttribute('href', '/stores?scope=all');
    await expect(page.locator('.stores__more')).toContainText('detected but not captured');
    // No v1 specimen numbering anywhere.
    expect(await page.locator('main').textContent()).not.toContain('N°');
  });

  test('the curated list view is a table of the same stores', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?view=index');
    expect(await total(page)).toBe(50);
    await expect(rows(page)).toHaveCount(50);
    await expect(rows(page).first().locator('.srow__name')).toHaveText('YoungLA');
  });

  test('all detected stores: the full table, in order, numbered without N°', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?scope=all');
    expect(await total(page)).toBe(930);
    await expect(rows(page)).toHaveCount(60);
    await expect(rows(page).first().locator('.srow__n')).toHaveText('1');
    await expect(rows(page).nth(59).locator('.srow__n')).toHaveText('60');
    // Curated stores lead the default order and are marked as such (or as captured).
    await expect(rows(page).first().locator('.srow__capture')).toContainText(/Curated|Captured/);
    await expect(rows(page).nth(50).locator('.srow__capture')).toContainText('Detected');
    expect(await page.locator('main').textContent()).not.toContain('N°');
  });

  test('a filter keeps the curated scope; the switch offers every detected store', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/stores?theme=prestige');
    const curated = await total(page);
    expect(curated).toBeGreaterThan(0);
    expect(curated).toBeLessThan(20);
    const cards = page.locator('.stores__grid .store-card');
    await expect(cards).toHaveCount(curated);
    for (const text of await cards.allTextContents()) expect(text).toContain('Prestige');
    // The active filter is shown as a removable chip that clears it.
    await expect(page.locator('.fbar__active a').first()).toHaveAttribute('href', '/stores');

    const all = page.locator('.stores__scope .seg__item').nth(1);
    await expect(all).toHaveAttribute('href', '/stores?scope=all&theme=prestige');
    await all.click();
    await expect(page).toHaveURL(/scope=all&theme=prestige/);
    const n = await total(page);
    expect(n).toBeGreaterThan(curated);
    expect(n).toBeLessThan(930);
    await expect(rows(page)).toHaveCount(n);
    for (const text of await rows(page).allTextContents()) expect(text).toContain('Prestige');
  });

  test('search finds a store by domain; a detected-only match points to all stores', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/stores');
    const search = page.locator('.fbar__search input[type="search"]');
    await search.fill('youngla');
    await search.press('Enter');
    await expect(page).toHaveURL(/[?&]q=youngla/);
    await expect(page.locator('.stores__grid .store-card')).toHaveCount(1);

    await page.goto('/stores?q=muji');
    await expect(page.locator('.empty')).toContainText('No curated store matches');
    await page.locator('.empty a', { hasText: 'Show all detected stores' }).click();
    await expect(page).toHaveURL(/q=muji&scope=all/);
    await expect(rows(page).first()).toContainText('muji.ca');
  });

  test('load more appends the next page of the table', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?scope=all');
    const more = page.locator('a[data-load-more]');
    await expect(more).toHaveAttribute('href', /scope=all.*cursor=.+&p=2/);
    const href = await more.getAttribute('href');
    const secondFirst = await (async () => {
      const res = await page.request.get(href!);
      const html = await res.text();
      return /class="srow__name[^"]*"[^>]*>\s*([^<\s][^<]*?)\s*</.exec(html)?.[1];
    })();
    await more.click();
    await expect(rows(page)).toHaveCount(120);
    await expect(rows(page).nth(60).locator('.srow__n')).toHaveText('61');
    await expect(rows(page).nth(60).locator('.srow__name')).toHaveText(secondFirst!);
    await expect(page.locator('[data-range]')).toHaveText('1–120');
    // Every row is a different store.
    const names = await page.locator('[data-store-index] .srow__name').allTextContents();
    expect(new Set(names).size).toBe(120);
  });

  test('the second page also works without JavaScript', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores?scope=all');
    const href = await page.locator('a[data-load-more]').getAttribute('href');
    await page.goto(href!);
    await expect(rows(page).first().locator('.srow__n')).toHaveText('61');
    await expect(page.locator('.sindex__first')).toHaveAttribute('href', '/stores?scope=all');
  });

  test('an empty filter result explains itself', async ({ page }) => {
    await prepare(page);
    // Empty whether or not a capture run has happened locally.
    await page.goto('/stores?scope=all&capture=captured&q=zzzz-no-such-store');
    await expect(page.locator('.empty')).toContainText('No stores match');
  });
});

test.describe('store detail', () => {
  test('healthy: curated store', async ({ page }) => {
    await expectHealthyPage(page, '/stores/youngla.com');
    await expect(page.locator('h1')).toHaveText('YoungLA');
    await expect(page.locator('.sid')).toContainText('Curated');
    await expect(page.locator('.sid')).toContainText('Prestige');
    expect(await page.locator('main').textContent()).not.toContain('N°');
  });

  for (const path of [
    '/stores/youngla.com?page=product&device=mobile',
    '/stores/thesill.com?page=collection',
    '/stores/eatfishwife.com?page=collection&device=mobile',
  ]) {
    test(`healthy: ${path}`, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('header links: visit store (not affiliate) and removal request', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    const visit = page.locator('a.sid__visit');
    await expect(visit).toHaveAttribute('rel', 'noopener');
    await expect(visit).toHaveAttribute('target', '_blank');
    await expect(visit).toHaveAttribute('href', /^https:\/\/(www\.)?youngla\.com/);
    await expect(page.locator('a[href="/opt-out?domain=youngla.com"]')).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.join('')).toContain('BreadcrumbList');
    expect(ld.join('')).toContain('OnlineStore');
  });

  test('facts card lists the theme, apps and source', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    const facts = page.locator('.store__aside .fcard');
    await expect(facts).toContainText('Prestige 9.3.0');
    const { apps } = await storeDetail(page, 'youngla.com');
    await expect(facts).toContainText(`${apps.total} detected`);
    await expect(facts).toContainText('Source:');
    await expect(page.locator('.store__aside a[href="/teardowns/youngla"]')).toBeVisible();
  });

  test('page tabs and the device switch change the viewer', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    const img = page.locator('.viewer .fp__canvas > img');
    await expect(img).toHaveAttribute('alt', /home page on desktop/);
    const home = await homeShot(page, 'youngla.com');
    await expect(page.locator('.viewer__state')).toContainText(
      home.is_placeholder ? 'Layout preview' : 'Captured',
    );

    await page.locator('.viewer__tabs a', { hasText: 'Product' }).click();
    await expect(page).toHaveURL(/[?&]page=product/);
    await expect(img).toHaveAttribute('alt', /product page on desktop/);
    await expect(page.locator('.viewer__tabs a[aria-current="page"]')).toContainText('Product');
    await expect(page.locator('.viewer .window__url')).toContainText('youngla.com/products/');

    await page.locator('.viewer__device a', { hasText: 'Mobile' }).click();
    await expect(page).toHaveURL(/page=product&device=mobile/);
    await expect(page.locator('.viewer .fp')).toHaveClass(/fp--mobile/);
    await expect(img).toHaveAttribute('alt', /product page on mobile/);

    await page.locator('.viewer__device a', { hasText: 'Desktop' }).click();
    await expect(page).toHaveURL(/page=product#plates$/);
    await expect(img).toHaveAttribute('alt', /product page on desktop/);
  });

  test('rail items scroll the capture to their section and show its app', async ({ page }) => {
    await prepare(page);
    // The first page of the store with an app-attributed section (fixture or real capture).
    const store = await storeDetail(page, 'youngla.com');
    const hit = store.pages
      .map((p) => ({ p, s: p.screenshots.desktop?.sections.find((x) => x.app) }))
      .find((x) => x.s);
    expect(hit, 'a section attributed to an app').toBeTruthy();
    const { p: withApp, s: section } = hit!;
    await page.goto(`/stores/youngla.com?page=${withApp.page_type.slug}`);
    const item = page.locator(`.viewer .fp__item[data-target="${section!.id}"]`);
    await expect(item).toContainText(section!.app!.short_name);
    const id = await item.getAttribute('data-target');
    await expect(page.locator(`#section-${id} .fp__tag`)).toContainText(section!.type.name);
    await item.click();
    await expect(page.locator(`#section-${id}`)).toBeInViewport();
    await expect(page).toHaveURL(new RegExp(`#section-${id}$`));
  });

  test('app placements link to the section on the right page', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    const jump = page.locator('.stack__jump', { hasText: 'Reviews on the product page' });
    const href = await jump.getAttribute('href');
    expect(href).toMatch(/^\/stores\/youngla\.com\?page=product#section-\d+$/);
    await jump.click();
    await expect(page).toHaveURL(/page=product#section-\d+$/);
    await expect(page.locator(href!.slice(href!.indexOf('#')))).toBeInViewport();
  });

  test('compare jumps to similar stores', async ({ page }) => {
    await prepare(page);
    await page.goto('/stores/youngla.com');
    await page.locator('.sid__actions a', { hasText: 'Compare' }).click();
    await expect(page).toHaveURL(/#similar$/);
    await expect(page.locator('#similar')).toBeInViewport();
    await expect(page.locator('#similar .srow').first()).toBeVisible();
  });

  test('uncaptured store: honest state, still useful, not indexed', async ({ page }) => {
    await expectHealthyPage(page, '/stores/muji.ca');
    await expect(page.locator('.nc')).toContainText('Not captured yet');
    await expect(page.locator('.sid')).toContainText('Detected only');
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
    await page.goto('/stores/WWW.YoungLA.com?page=product');
    await expect(page).toHaveURL(/\/stores\/youngla\.com\?page=product$/);
  });
});
