import { test, expect, type Page } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Light/dark theme: pre-paint resolution, the header toggle / menu switch, persistence, the
 * system preference, and layout health in dark at 390px and 1440px.
 */

/** A colour token resolved to rgb() on <html> (the build may minify the hex in the CSS). */
const rootToken = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    document.documentElement.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
const theme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const isDesktop = (page: Page) => page.viewportSize()!.width >= 1024;

/** Pick dark with the control visible at this width (header toggle, or the menu sheet). */
async function chooseDark(page: Page) {
  if (isDesktop(page)) {
    const toggle = page.locator('header[data-header]').getByRole('button', { name: 'Dark theme' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  } else {
    await page.getByRole('button', { name: 'Open menu' }).click();
    const sheet = page.locator('dialog[data-menu]');
    await sheet.getByRole('radio', { name: 'Dark' }).click();
    await expect(sheet.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');
  }
}

test('light is the default without a stored choice or a dark system', async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  expect(await theme(page)).toBe('light');
  expect(await rootToken(page, '--bg')).toBe('rgb(255, 255, 255)');
  await expect(page.locator('html')).toHaveClass(/\bjs\b/);
});

test('the toggle switches to dark and the choice survives a reload', async ({ page }) => {
  const errors = await prepare(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/design-system');
  await chooseDark(page);
  expect(await theme(page)).toBe('dark');
  expect(await rootToken(page, '--bg')).toBe('rgb(10, 10, 11)');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0a0b');

  await page.reload();
  expect(await theme(page)).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(10, 10, 11)',
  );
  // The footer switch reflects the stored preference.
  await expect(page.locator('footer').getByRole('radio', { name: 'Dark' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Back to System from the footer switch: follows the (light) system again.
  await page.locator('footer').getByRole('radio', { name: 'System' }).click();
  expect(await theme(page)).toBe('light');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('system');
  expect(errors).toEqual([]);
});

test('prefers-color-scheme: dark yields dark tokens without a stored choice', async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
  expect(await theme(page)).toBe('dark');
  expect(await rootToken(page, '--bg')).toBe('rgb(10, 10, 11)');
  expect(await rootToken(page, '--ink')).toBe('rgb(242, 242, 240)');
  // While on "system", a change of the OS preference is followed live.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => theme(page)).toBe('light');
});

test('without JavaScript the media query still themes the page', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/design-system');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(10, 10, 11)',
  );
  await context.close();
});

test('a blocked localStorage falls back to the system theme without errors', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  const errors = await prepare(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  expect(await theme(page)).toBe('dark');
  if (isDesktop(page)) {
    await page.locator('header[data-header]').getByRole('button', { name: 'Dark theme' }).click();
    expect(await theme(page)).toBe('light');
  }
  expect(errors).toEqual([]);
});

test.describe('dark theme pages are healthy', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme', 'dark');
      } catch {
        /* ignore */
      }
    });
  });
  for (const path of ['/', '/design-system']) {
    test(path, async ({ page }) => {
      await expectHealthyPage(page, path);
      expect(await theme(page)).toBe('dark');
    });
  }
});
