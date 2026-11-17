import { test, expect } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

test('design system page renders every component cleanly', async ({ page }) => {
  await expectHealthyPage(page, '/design-system');
  await expect(page.locator('[data-fullpage]')).toHaveCount(1);
  // Both theme panels render from the same markup through data-theme subtrees.
  await expect(page.locator('.ds-themepanel[data-theme="light"]')).toHaveCount(1);
  await expect(page.locator('.ds-themepanel[data-theme="dark"]')).toHaveCount(1);
  const panelBg = await page
    .locator('.ds-themepanel')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(panelBg).toEqual(['rgb(255, 255, 255)', 'rgb(10, 10, 11)']);
  // Every section in the capture has a pinned tag.
  const regions = page.locator('[data-fullpage] .fp__region');
  expect(await regions.count()).toBeGreaterThan(3);
  await expect(page.locator('[data-fullpage] .fp__region .fp__tag')).toHaveCount(
    await regions.count(),
  );
});

test('header: search trigger and navigation adapt to width', async ({ page }) => {
  await prepare(page);
  await page.goto('/design-system');
  const width = page.viewportSize()!.width;
  const header = page.locator('header[data-header]');
  for (const href of ['/stores', '/themes', '/apps', '/sections', '/teardowns', '/compare']) {
    await expect(header.locator(`.header__nav a[href="${href}"]`)).toHaveCount(1);
  }
  if (width >= 1024) {
    await expect(page.locator('.header__nav')).toBeVisible();
    await expect(page.locator('.search-trigger')).toBeVisible();
    await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Get Pro' })).toHaveAttribute('href', '/pro');
    await expect(header.getByRole('button', { name: 'Dark theme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
  } else {
    await expect(page.locator('.header__nav')).toBeHidden();
    await expect(page.locator('.search-trigger')).toBeVisible();
    const open = page.getByRole('button', { name: 'Open menu' });
    await open.click();
    const menu = page.locator('dialog[data-menu]');
    await expect(menu).toBeVisible();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    // The sheet has the nav, the theme switch and the Pro CTA, and locks page scroll.
    await expect(menu.getByRole('link', { name: /^Stores/ })).toBeVisible();
    await expect(menu.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Get Pro' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
      'hidden',
    );
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(menu).toBeHidden();
    // Escape closes it too, and focus returns to the menu button.
    await open.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(open).toBeFocused();
  }
});

test('header gains a hairline once the page scrolls', async ({ page }) => {
  await prepare(page);
  await page.goto('/design-system');
  const header = page.locator('header[data-header]');
  await expect(header).not.toHaveAttribute('data-scrolled', /.*/);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(header).toHaveAttribute('data-scrolled', '');
});

test('footer: columns, legal entity and disclaimer', async ({ page }) => {
  await prepare(page);
  await page.goto('/design-system');
  const footer = page.locator('footer.footer');
  for (const col of ['Explore', 'Compare', 'Product', 'Company', 'Legal']) {
    await expect(footer.getByRole('navigation', { name: col })).toHaveCount(1);
  }
  for (const href of [
    '/stores',
    '/themes',
    '/apps',
    '/sections',
    '/teardowns',
    '/compare',
    '/alternatives',
    '/pro',
    '/developers',
    '/methodology',
    '/about',
    '/affiliate-disclosure',
    '/opt-out',
    '/privacy',
    '/terms',
  ]) {
    await expect(footer.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
  await expect(footer).toContainText(/© \d{4} Xovist/);
  await expect(footer).toContainText('Not affiliated with Shopify Inc.');
  await expect(footer.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
});

test('segmented and tabs slide one indicator', async ({ page }) => {
  await prepare(page);
  await page.goto('/design-system');
  const seg = page.getByRole('group', { name: 'Billing' });
  await expect(seg).toHaveAttribute('data-indicator-ready', '');
  const x = () => seg.evaluate((el) => getComputedStyle(el).getPropertyValue('--ind-x'));
  const before = await x();
  await seg.getByRole('button', { name: /Yearly/ }).click();
  await expect(seg.getByRole('button', { name: /Yearly/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(x).not.toBe(before);
  await expect(page.getByRole('navigation', { name: 'Page type' })).toHaveAttribute(
    'data-indicator-ready',
    '',
  );
});
