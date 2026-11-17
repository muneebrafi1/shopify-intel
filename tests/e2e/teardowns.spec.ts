import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/** /teardowns and /teardowns/<slug>. Runs at 390px and 1440px (playwright.config.ts). */

test.describe('teardowns', () => {
  test('index is healthy and labels samples', async ({ page }) => {
    await expectHealthyPage(page, '/teardowns');
    await expect(page.locator('a[href="/teardowns/youngla"]').first()).toBeVisible();
    await expect(page.locator('.tds')).toContainText('Sample');
  });

  for (const slug of ['youngla', 'thesill', 'fishwife']) {
    test(`detail is healthy: ${slug}`, async ({ page }) => {
      await expectHealthyPage(page, `/teardowns/${slug}`);
      const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join(
        '',
      );
      expect(ld).toContain('"Article"');
      expect(ld).toContain('BreadcrumbList');
      await expect(page.locator('.td__sheet a[href^="/stores/"]').first()).toBeVisible();
    });
  }

  test('note numbers match the section numbers on the capture', async ({ page }) => {
    await prepare(page);
    await page.goto('/teardowns/youngla');
    const nums = page.locator('.tdnote__num');
    const count = await nums.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const num = (await nums.nth(i).textContent())!.trim();
      const href = await nums.nth(i).getAttribute('href');
      const id = href!.replace('#section-', '');
      // FullPage tags read "02 Header · App": same number as the rail on the store page.
      await expect(page.locator(`[data-region="${id}"] .fp__tag`)).toContainText(num);
    }
  });

  test('a note scrolls to its section and plate tabs switch the plate', async ({ page }) => {
    await prepare(page);
    await page.goto('/teardowns/youngla');
    const first = page.locator('.tdnote__num').first();
    const href = await first.getAttribute('href');
    await first.click();
    await expect(page.locator(href!)).toBeInViewport();

    const tabs = page.locator('.tdplates__tabs a');
    expect(await tabs.count()).toBeGreaterThan(1);
    await tabs.nth(1).click();
    await expect(page).toHaveURL(/[?&]plate=[a-z-]+/);
    await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'page');
  });

  test('unknown teardown is a 404', async ({ page }) => {
    await expectHealthyPage(page, '/teardowns/does-not-exist', { status: 404 });
  });
});
