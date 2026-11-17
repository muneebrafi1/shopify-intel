import { expect, test, type Page } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Home page (hero, product window, store strip, how it works, feature bento, latest captures,
 * Pro band) and the global command palette. Runs at 390px and 1440px (playwright.config.ts).
 */

const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

/** CSS animations currently running inside an element (hover transitions excluded). */
const runningAnimations = (page: Page, selector: string) =>
  page.evaluate(
    (sel) =>
      document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return (
          a instanceof CSSAnimation &&
          target instanceof Element &&
          !!target.closest(sel) &&
          a.playState === 'running'
        );
      }).length,
    selector,
  );

test.describe('home', () => {
  test('is healthy', async ({ page }) => {
    await expectHealthyPage(page, '/');
    const h1 = page.locator('h1');
    await expect(h1).toContainText('Shopify themes and apps');
    await expect(h1).toContainText('on the stores that run them.');
    // The live, dated counter under the hero.
    const counter = page.locator('.hero .counter');
    await expect(counter).toContainText(/[\d,]+ stores scanned/);
    await expect(counter).toContainText(/[\d,]+ sections tagged/);
    await expect(counter).toContainText(/scanned \d{1,2} [A-Za-z]{3} \d{4}/);
    // Blocks, in order.
    const ids = ['strip-title', 'how-title', 'home-features', 'home-captures', 'pro-title'];
    const tops: number[] = [];
    for (const id of ids) {
      const el = page.locator(`#${id}`);
      await expect(el).toHaveCount(1);
      tops.push(await el.evaluate((n) => n.getBoundingClientRect().top + window.scrollY));
    }
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  test('the announcement pill links the newest teardown', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const pill = page.locator('.hero .announce');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText(/Teardown:/);
    await expect(pill).toHaveAttribute('href', /^\/teardowns\/[a-z0-9-]+$/);
  });

  test('hero actions: browse stores, and search as a link to /search', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const hero = page.locator('.hero');
    await expect(hero.getByRole('link', { name: 'Browse stores' })).toHaveAttribute(
      'href',
      '/stores',
    );
    const search = hero.getByRole('link', { name: /^Search/ });
    await expect(search).toHaveAttribute('href', '/search');
    await expect(search).toHaveAttribute('data-palette-open', /.*/);
    for (const box of [
      await hero.getByRole('link', { name: 'Browse stores' }).boundingBox(),
      await search.boundingBox(),
    ]) {
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('without JS: search goes to /search, steps stay readable, nothing is hidden', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/');
    // Reveal-on-scroll never hides content without JS.
    const hidden = await page
      .locator('.reveal')
      .evaluateAll((els) => els.filter((el) => getComputedStyle(el).opacity !== '1').length);
    expect(hidden).toBe(0);
    // The product window's page types and sections are plain links into the store viewer.
    const pageLinks = page.locator('[data-pw-page]');
    expect(await pageLinks.count()).toBeGreaterThanOrEqual(2);
    for (const href of await pageLinks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('href') ?? ''),
    )) {
      expect(href).toMatch(/^\/stores\/[a-z0-9.-]+\?page=[a-z-]+&device=desktop$/);
    }
    await page
      .locator('.hero')
      .getByRole('link', { name: /^Search/ })
      .click();
    await page.waitForURL(/\/search$/);
    await context.close();
  });

  test('the product window: page types switch in place, rows light their section', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/');
    const win = page.locator('[data-pw]');
    await expect(win.locator('.window__url')).toHaveText(/\./);
    if (!isWide(page)) {
      // Phones get the mobile capture with its first tags, cropped; no sidebars.
      await expect(win.locator('.pw__phone')).toBeVisible();
      await expect(win.locator('.pw__side')).toBeHidden();
      await expect(win.locator('.pw__list')).toBeHidden();
      const tags = win.locator('.pw__phone .fp__tag');
      expect(await tags.count()).toBeGreaterThanOrEqual(3);
      await expect(tags.first()).toBeVisible();
      return;
    }
    const current = win.locator('[data-pw-page][aria-current="true"]');
    await expect(current).toHaveCount(1);
    const visiblePane = win.locator('[data-pw-pane]:not([hidden])');
    await expect(visiblePane).toHaveCount(1);
    expect(await visiblePane.locator('.fp__tag').count()).toBeGreaterThanOrEqual(4);

    // Switch to another page type without leaving the home page.
    const slug = await win
      .locator('[data-pw-page]:not([aria-current])')
      .first()
      .getAttribute('data-pw-page');
    const other = win.locator(`[data-pw-page="${slug}"]`);
    await other.click();
    await expect(other).toHaveAttribute('aria-current', 'true');
    await expect(win.locator(`[data-pw-pane="${slug}"]`)).toBeVisible();
    await expect(win.locator(`[data-pw-list="${slug}"]`)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');

    // Hovering a section row outlines its region on the capture; clicking marks it current.
    const row = win.locator(`[data-pw-list="${slug}"] [data-pw-target]`).nth(2);
    const id = await row.getAttribute('data-pw-target');
    await row.hover();
    await expect(win.locator(`[data-region="${id}"]`)).toHaveClass(/is-hover/);
    await row.click();
    await expect(row).toHaveAttribute('aria-current', '');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('the curated strip lists curated stores and links to them', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const links = page.locator('.strip__link:visible');
    expect(await links.count()).toBeGreaterThanOrEqual(6);
    for (const href of await links.evaluateAll((els) =>
      els.map((el) => el.getAttribute('href') ?? ''),
    )) {
      expect(href).toMatch(/^\/stores\/[a-z0-9.-]+$/);
    }
  });

  test('how it works: the active step drives the visual and is keyboard operable', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/');
    const how = page.locator('[data-how]');
    await expect(how).toHaveAttribute('data-theme', 'dark');
    if (!isWide(page)) {
      // Phones: every step stacked with its own visual.
      await expect(how.locator('.how__grid')).toBeHidden();
      const items = how.locator('.how__item');
      expect(await items.count()).toBeGreaterThanOrEqual(3);
      for (const item of await items.all()) await expect(item.locator('.hv')).toBeVisible();
      return;
    }
    const buttons = how.locator('.how__btn');
    expect(await buttons.count()).toBeGreaterThanOrEqual(3);
    await expect(buttons.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(how.locator('#how-v-0')).toBeVisible();
    await expect(how.locator('#how-v-1')).toBeHidden();

    await buttons.nth(1).click();
    await expect(buttons.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(buttons.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(how.locator('#how-v-1')).toBeVisible();
    await expect(how.locator('#how-d-1')).toBeVisible();
    await expect(how.locator('#how-d-0')).toBeHidden();

    // Arrow keys move between steps.
    await page.keyboard.press('ArrowDown');
    await expect(buttons.nth(2)).toBeFocused();
    await expect(buttons.nth(2)).toHaveAttribute('aria-expanded', 'true');
    await expect(how.locator('#how-v-2 .cc__tag').first()).toBeVisible();
  });

  test('the bento shows real data; app ranks come from usage.rank', async ({ page, request }) => {
    await prepare(page);
    await page.goto('/');
    const res = await request.get('/api/v1/apps?limit=6');
    const apps = (await res.json()).data.items as Array<{
      short_name: string;
      usage: { rank: number | null; stores: number };
    }>;
    const rows = page.locator('.ranks__row');
    await expect(rows).toHaveCount(apps.length);
    for (const [i, app] of apps.entries()) {
      await expect(rows.nth(i).locator('.ranks__n')).toHaveText(String(app.usage.rank ?? '–'));
      await expect(rows.nth(i).locator('.ranks__title')).toHaveText(app.short_name);
    }
    // Ties share a rank: equal usage → equal rank.
    for (let i = 1; i < apps.length; i++) {
      if (apps[i]!.usage.stores === apps[i - 1]!.usage.stores)
        expect(apps[i]!.usage.rank).toBe(apps[i - 1]!.usage.rank);
    }
    // Every card carries UI, not an icon: a table, a compare pair, tagged crops, a capture.
    await expect(page.locator('.bento .tt tbody tr').first()).toBeVisible();
    await expect(page.locator('.bento .pair')).toHaveAttribute('href', /^\/compare\//);
    expect(await page.locator('.bento .crops__tag:visible').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.bento .td .cc__marker').first()).toBeVisible();
    await expect(page.locator('.bento .source-note').first()).toContainText(
      /\d{1,2} [A-Za-z]{3} \d{4}/,
    );
  });

  test('latest captures link to a store page at a page type and device', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const tiles = page.locator('a.wall__tile');
    expect(await tiles.count()).toBeGreaterThanOrEqual(20);
    const hrefs = await tiles.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    for (const href of hrefs) {
      expect(href).toMatch(
        /^\/stores\/[a-z0-9.-]+\?page=(home|collection|product)&device=(desktop|mobile)$/,
      );
    }
    expect(hrefs.some((h) => h.endsWith('device=mobile'))).toBe(true);
    expect(hrefs.some((h) => h.endsWith('device=desktop'))).toBe(true);
    // Each tile is named (store, page, device) and carries its domain pill.
    await expect(tiles.first()).toHaveAttribute('aria-label', /, home page, (desktop|mobile)/);
    await expect(tiles.first().locator('.wall__pill')).toContainText(/\./);
  });

  test('the gallery is static and reveals are skipped with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await prepare(page);
    await page.goto('/');
    await page.waitForLoadState('load');
    expect(await runningAnimations(page, '.wall')).toBe(0);
    const hidden = await page
      .locator('.reveal')
      .evaluateAll((els) => els.filter((el) => getComputedStyle(el).opacity !== '1').length);
    expect(hidden).toBe(0);
  });

  test('the Pro band shows plan prices and two actions', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const pro = page.locator('section.pro');
    await expect(pro).toHaveAttribute('data-theme', 'dark');
    await expect(pro).toContainText(/\$\d+ a month/);
    await expect(pro.getByRole('link', { name: /Get Pro/ })).toHaveClass(/btn--accent/);
    await expect(pro.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/pro');
  });

  test('ships WebSite (with SearchAction) and Organization JSON-LD', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const ld = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((els) =>
        els.map((el) => JSON.parse(el.textContent ?? '{}') as Record<string, unknown>),
      );
    const site = ld.find((x) => x['@type'] === 'WebSite') as {
      potentialAction?: { target?: { urlTemplate?: string } };
    };
    expect(site?.potentialAction?.target?.urlTemplate).toMatch(
      /\/search\?q=\{search_term_string\}$/,
    );
    expect(ld.some((x) => x['@type'] === 'Organization' && typeof x.name === 'string')).toBe(true);
  });
});

test.describe('command palette', () => {
  test('Ctrl+K opens it, "pre" finds Prestige, Esc closes, Enter opens the active result', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/');
    const dialog = page.locator('dialog[data-palette]');
    const input = page.getByRole('combobox', { name: /search/i });

    await page.keyboard.press('Control+k');
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await input.pressSequentially('pre');
    const prestige = dialog.getByRole('option', { name: /Prestige/ }).first();
    await expect(prestige).toBeVisible();
    // Wait for the search results (not the idle suggestions, which also list Prestige).
    await expect(dialog.locator('[data-palette-count]')).toContainText(/\d+ results?/);
    // The first result is active and announced through aria-activedescendant.
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const activeId = await input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    await expect(dialog.locator(`#${activeId}`)).toHaveAttribute('aria-selected', 'true');

    // Arrow keys move the active row.
    await page.keyboard.press('ArrowDown');
    expect(await input.getAttribute('aria-activedescendant')).not.toBe(activeId);
    await page.keyboard.press('ArrowUp');
    expect(await input.getAttribute('aria-activedescendant')).toBe(activeId);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // "/" opens it too (when not typing in a field).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('/');
    await expect(dialog).toBeVisible();
    await input.pressSequentially('pre');
    await expect(dialog.getByRole('option', { name: /Prestige/ }).first()).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/themes\/prestige$/);
  });

  test('"/" typed into a field is left alone', async ({ page }) => {
    await prepare(page);
    await page.goto('/search');
    const field = page.locator('#search-q');
    await field.focus();
    await page.keyboard.type('a/b');
    await expect(field).toHaveValue('a/b');
    await expect(page.locator('dialog[data-palette]')).toBeHidden();
  });

  test('the header search trigger opens it instead of navigating', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page.locator('header [data-palette-open]:visible').first().click();
    await expect(page.locator('dialog[data-palette]')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('the hero Search button opens it instead of navigating', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page
      .locator('.hero')
      .getByRole('link', { name: /^Search/ })
      .click();
    await expect(page.locator('dialog[data-palette]')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /search/i })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('shows an empty state for no matches and recent searches afterwards', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const dialog = page.locator('dialog[data-palette]');
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox', { name: /search/i });
    await input.pressSequentially('zzzzzz');
    await expect(dialog.locator('[data-palette-state]')).toContainText('No matches');
    // Enter with no result goes to the full results page and remembers the query.
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/search\?q=zzzzzz/);
    await page.keyboard.press('Control+k');
    await expect(dialog.getByRole('option', { name: 'zzzzzz' })).toBeVisible();
  });
});
