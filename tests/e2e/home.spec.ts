import { expect, test, type Page } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Home page (statement, wall, catalogue blocks) and the global command palette.
 * Runs at 390px and 1440px (playwright.config.ts).
 */

/** CSS animations (the drift, not hover transitions) currently running inside the wall. */
const wallAnimations = (page: Page) =>
  page.evaluate(
    () =>
      document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return (
          a instanceof CSSAnimation &&
          target instanceof Element &&
          !!target.closest('.wall') &&
          a.playState === 'running'
        );
      }).length,
  );

test.describe('home', () => {
  test('is healthy', async ({ page }) => {
    await expectHealthyPage(page, '/');
    await expect(page.locator('h1')).toContainText('Shopify themes and apps');
    // The live, dated spec line under the statement.
    await expect(page.locator('.hero__spec')).toContainText(/stores scanned/i);
    await expect(page.locator('.hero__spec')).toContainText(/data \d{1,2} [a-z]{3} \d{4}/i);
    // Catalogue blocks, in order.
    for (const id of [
      'home-themes',
      'home-apps',
      'home-sections',
      'home-teardowns',
      'home-compare',
      'home-builders',
    ]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('quick entry links go to the four indexes', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Browse the archive' });
    for (const href of ['/stores', '/themes', '/apps', '/sections']) {
      await expect(nav.locator(`a[href="${href}"]`)).toBeVisible();
    }
  });

  test('the search field works without JS as a GET form to /search', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/');
    const form = page.locator('form[data-home-search]');
    await expect(form).toHaveAttribute('action', '/search');
    await form.locator('input[name="q"]').fill('prestige');
    await form.locator('input[name="q"]').press('Enter');
    await page.waitForURL(/\/search\?q=prestige/);
    await context.close();
  });

  test('wall tiles link to a store page at a page type and device', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const tiles = page.locator('.wall__set:not([aria-hidden]) a.wall__tile');
    expect(await tiles.count()).toBeGreaterThanOrEqual(20);
    const hrefs = await tiles.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    for (const href of hrefs) {
      expect(href).toMatch(
        /^\/stores\/[a-z0-9.-]+\?page=(home|collection|product)&device=(desktop|mobile)$/,
      );
    }
    expect(hrefs.some((h) => h.endsWith('device=mobile'))).toBe(true);
    expect(hrefs.some((h) => h.endsWith('device=desktop'))).toBe(true);
    // Each tile carries its domain pill; the looping copy is hidden from assistive tech and tabbing.
    await expect(tiles.first().locator('.wall__pill')).toContainText(/\./);
    const copy = page.locator('.wall__set[aria-hidden="true"] a.wall__tile').first();
    await expect(copy).toHaveAttribute('tabindex', '-1');
  });

  test('the wall drifts and pauses on demand', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    expect(await wallAnimations(page)).toBeGreaterThan(0);
    // The CSS-only toggle pauses it.
    await page.locator('label[for="wall-pause"]').click();
    expect(await wallAnimations(page)).toBe(0);
  });

  test('the wall is static with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await prepare(page);
    await page.goto('/');
    await page.waitForLoadState('load');
    expect(await wallAnimations(page)).toBe(0);
    const name = await page
      .locator('.wall__track')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('none');
    await expect(page.locator('label[for="wall-pause"]')).toBeHidden();
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
    // The first result is active and announced through aria-activedescendant.
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const activeId = await input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    await expect(dialog.locator(`#${activeId}`)).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('[data-palette-count]')).toContainText(/\d+ results?/);

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
    await page.locator('[data-palette-open]:visible').first().click();
    await expect(page.locator('dialog[data-palette]')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('typing in the home field hands the query to the palette', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page.locator('#home-q').focus();
    await page.keyboard.type('j');
    const input = page.getByRole('combobox', { name: /search/i });
    await expect(page.locator('dialog[data-palette]')).toBeVisible();
    await expect(input).toHaveValue('j');
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
