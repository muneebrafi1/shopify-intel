import { test, expect } from '@playwright/test';
import { expectHealthyPage } from './helpers';

test('design system page renders every component cleanly', async ({ page }) => {
  await expectHealthyPage(page, '/design-system');
  await expect(page.locator('[data-fullpage]')).toHaveCount(1);
});

test('header: search trigger and navigation adapt to width', async ({ page }) => {
  await page.goto('/design-system');
  const width = page.viewportSize()!.width;
  if (width >= 1024) {
    await expect(page.locator('.header__nav')).toBeVisible();
    await expect(page.locator('.search-trigger')).toBeVisible();
  } else {
    await expect(page.locator('.header__nav')).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('dialog[data-menu]')).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(page.locator('dialog[data-menu]')).toBeHidden();
  }
});
