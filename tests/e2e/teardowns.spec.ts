import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/** /teardowns and /teardowns/<slug>. Runs at 390px and 1440px (playwright.config.ts). */

test.describe('teardowns', () => {
  test('index is healthy, leads with the newest and labels samples', async ({ page }) => {
    await expectHealthyPage(page, '/teardowns');
    await expect(page.locator('.lead a[href="/teardowns/negativeunderwear"]')).toBeVisible();
    await expect(page.locator('.tds')).toContainText('Sample');
    await expect(page.locator('.tds__grid .td-card')).toHaveCount(5);
    expect(await page.locator('main').textContent()).not.toContain('N°');
  });

  for (const slug of [
    'negativeunderwear',
    'lskd',
    'thursdayboots',
    'youngla',
    'thesill',
    'fishwife',
  ]) {
    test(`detail is healthy: ${slug}`, async ({ page }) => {
      await expectHealthyPage(page, `/teardowns/${slug}`);
      const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join(
        '',
      );
      expect(ld).toContain('"Article"');
      expect(ld).toContain('BreadcrumbList');
      await expect(page.locator('.td__sheet a[href^="/stores/"]').first()).toBeVisible();
      await expect(page.locator('.td__byline')).toContainText('Editorial team');
      expect(await page.locator('main').textContent()).not.toContain('N°');
    });
  }

  test('reading column: 680px max, sans title, TOC only on wide screens', async ({ page }) => {
    await prepare(page);
    await page.goto('/teardowns/youngla');
    const column = await page.locator('.td__main').boundingBox();
    expect(column!.width).toBeLessThanOrEqual(681);
    const font = await page.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toMatch(/^"?Instrument Sans/);
    expect(font).not.toMatch(/Newsreader/i);
    const wide = (page.viewportSize()?.width ?? 0) >= 1200;
    await expect(page.locator('.td__toc')).toBeVisible({ visible: wide });
    if (wide) {
      await page.locator('.td__toc a', { hasText: 'The stack' }).click();
      await expect(page.locator('#stack')).toBeInViewport();
    }
  });

  test('the corrected YoungLA text renders: ten identified apps, no Trustgear', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/teardowns/youngla');
    const prose = page.locator('.td-prose');
    await expect(prose).toContainText('Ten are identified apps');
    await expect(prose).not.toContainText('Trustgear');
    // Numbered takeaways keep inline code inside the item's text cell.
    const item = prose.locator('ol.md-ol li').last();
    await expect(item.locator('> span')).toContainText('trustpilot');
    await expect(item.locator('> span code')).toHaveCount(1);
  });

  test('note numbers match the section numbers on the capture', async ({ page }) => {
    await prepare(page);
    await page.goto('/teardowns/youngla');
    // Notes whose section type is not on the current capture have no link (shown as "—").
    const nums = page.locator('a.tdnote__num[href]');
    const count = await nums.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const num = (await nums.nth(i).textContent())!.trim();
      const href = await nums.nth(i).getAttribute('href');
      const id = href!.replace('#section-', '');
      // FullPage tags read "02 Header · App": same number as the rail on the store page.
      const tag = page.locator(`[data-region="${id}"] .fp__tag`);
      await expect(tag).toContainText(num);
      // Annotated sections keep their tag visible.
      await expect(tag).toHaveCSS('opacity', '1');
    }
  });

  test('a note scrolls to its section and capture tabs switch the capture', async ({ page }) => {
    await prepare(page);
    await page.goto('/teardowns/youngla');
    const first = page.locator('a.tdnote__num[href]').first();
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
