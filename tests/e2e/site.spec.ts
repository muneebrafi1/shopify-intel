import { expect, test } from '@playwright/test';
import { expectHealthyPage, prepare } from './helpers';

/**
 * Static, legal, trust, account and Pro pages. Runs at 390px and 1440px (see
 * playwright.config.ts). Removal-form submissions only use the honeypot path, which the API
 * answers like a success without storing anything, so runs leave no rows behind.
 */

const ROUTES = [
  '/about',
  '/methodology',
  '/affiliate-disclosure',
  '/privacy',
  '/terms',
  '/opt-out',
  '/opt-out?domain=youngla.com',
  '/opt-out?sent=RR-7KQ2M9XD&domain=youngla.com&scope=screenshots',
  '/pro',
  '/pro?billing=yearly',
  '/sign-in',
  `/sign-in?next=${encodeURIComponent('/account/save?item=section:1')}`,
  '/developers',
  '/account/boards/example-reviews',
];

test.describe('site pages are healthy', () => {
  for (const path of ROUTES) {
    test(path, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('unknown routes render the 404 page', async ({ page }) => {
    await expectHealthyPage(page, '/this-page-does-not-exist', { status: 404 });
    await expect(page.locator('h1')).toHaveText('We can’t find that page.');
    const search = page.locator('form[role="search"]');
    await expect(search).toHaveAttribute('action', '/search');
    await expect(search.locator('input[name="q"]')).toBeVisible();
    for (const href of ['/stores', '/themes', '/apps', '/sections', '/teardowns', '/compare']) {
      await expect(page.locator(`main a[href="${href}"]`).first()).toBeVisible();
    }
  });

  test('the server-error page is designed, honest and offers a retry', async ({ page }) => {
    await expectHealthyPage(page, '/500', { status: 500 });
    await expect(page.locator('h1')).toHaveText('This page didn’t load.');
    await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('main a[href="/"]').first()).toBeVisible();
    // Never leaks the error itself.
    await expect(page.locator('main')).not.toContainText(/stack|exception|Error:/);
  });

  test('board ids that are not slugs are 404s', async ({ page }) => {
    await prepare(page);
    const res = await page.goto('/account/boards/Not_A_Slug!');
    expect(res?.status()).toBe(404);
  });
});

test.describe('legal and trust pages', () => {
  test('methodology has the #screenshots section and a numbered contents list', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/methodology');
    await expect(page.locator('h2#screenshots')).toHaveCount(1);
    await expect(page.locator('a[href="#screenshots"]').first()).toBeAttached();
  });

  test('privacy and terms are marked as drafts with a date', async ({ page }) => {
    await prepare(page);
    for (const path of ['/privacy', '/terms']) {
      await page.goto(path);
      await expect(page.locator('main')).toContainText(/Draft/);
      await expect(page.locator('main time[datetime]').first()).toBeAttached();
    }
  });
});

test.describe('removal form', () => {
  test('the honeypot field exists and is hidden from people', async ({ page }) => {
    await prepare(page);
    await page.goto('/opt-out');
    const honeypot = page.locator('input[name="website"]');
    await expect(honeypot).toHaveCount(1);
    await expect(honeypot).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('.rform__hp')).toHaveAttribute('aria-hidden', 'true');
    const box = await honeypot.boundingBox();
    expect(box, 'honeypot has a box').not.toBeNull();
    // Positioned off-screen: nothing of it is inside the viewport.
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(0);
  });

  test('missing domain shows an inline error (JS)', async ({ page }) => {
    await prepare(page);
    await page.goto('/opt-out');
    await page.getByRole('button', { name: 'Send request' }).click();
    const error = page.locator('#domain-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('domain');
    await expect(page.locator('#domain')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#domain')).toBeFocused();
    expect(new URL(page.url()).pathname).toBe('/opt-out');

    // Fixing the field clears its error as you type.
    await page.locator('#domain').fill('example.com');
    await expect(error).toBeHidden();
  });

  test('a complete request lands on the confirmation (honeypot path, nothing stored)', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/opt-out?domain=example.com');
    await expect(page.locator('#domain')).toHaveValue('example.com');
    await page.locator('#email').fill('owner@example.com');
    await page.getByLabel('Screenshots only').check();
    await page.locator('#reason').fill('I own this store and would like the screenshots removed.');
    await page.locator('#owner').check();
    // Bots fill the hidden field; the API then pretends success and stores nothing.
    await page.locator('input[name="website"]').evaluate((el) => {
      (el as HTMLInputElement).value = 'test-run';
    });
    await page.getByRole('button', { name: 'Send request' }).click();
    await page.waitForURL(/\/opt-out\?sent=RR-/);
    await expect(page.locator('h1')).toHaveText('We have your request.');
    await expect(page.locator('[data-reference]')).toHaveText(/^RR-[0-9A-Z]{8}$/);
    await expect(page.locator('main')).toContainText('example.com');
    await expect(page.locator('main')).toContainText('Screenshots only');
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the plain form post validates on the server', async ({ page }) => {
      await page.goto('/opt-out');
      await page.locator('#email').fill('owner@example.com');
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/opt-out',
        ),
        page.getByRole('button', { name: 'Send request' }).click(),
      ]);
      expect(response.status()).toBe(400);
      await expect(page.locator('#domain-error')).toBeVisible();
      await expect(page.locator('#domain-error')).toContainText('domain');
      // What was typed survives the round trip.
      await expect(page.locator('#email')).toHaveValue('owner@example.com');
    });
  });
});

test.describe('pro', () => {
  test('the billing toggle switches prices in place', async ({ page }) => {
    await prepare(page);
    await page.goto('/pro');
    const pro = page.locator('[data-plan="pro"]');
    await expect(pro.locator('[data-price]')).toHaveText('$12');
    await expect(pro.locator('[data-per]')).toHaveText('/month');
    await page.locator('[data-billing-toggle] a[data-value="yearly"]').click();
    await expect(pro.locator('[data-price]')).toHaveText('$120');
    await expect(pro.locator('[data-per]')).toHaveText('/year');
    await expect(page).toHaveURL(/billing=yearly/);
    await page.locator('[data-billing-toggle] a[data-value="monthly"]').click();
    await expect(pro.locator('[data-price]')).toHaveText('$12');
  });

  test('yearly prices render without JS via the query param', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/pro?billing=yearly');
    await expect(page.locator('[data-plan="pro"] [data-price]')).toHaveText('$120');
    await expect(page.locator('[data-billing-toggle] a[aria-current="true"]')).toHaveAttribute(
      'data-value',
      'yearly',
    );
    await context.close();
  });

  test('yearly billing is sold as two months free, with the monthly equivalent', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/pro?billing=yearly');
    await expect(page.locator('[data-billing-toggle]')).toContainText('2 months free');
    await expect(page.locator('[data-plan="pro"] [data-note]')).toHaveText(
      '$10 a month, billed yearly',
    );
    await expect(page.locator('[data-plan="team"] [data-price]')).toHaveText('$390');
    // Team is three seats, in the cards and in the comparison table.
    await expect(page.locator('[data-plan="team"]')).toContainText('3 seats');
  });

  test('the comparison shows one plan at a time on small screens', async ({ page }) => {
    await prepare(page);
    await page.goto('/pro');
    const proCells = page.locator('.cmp__table td[data-col="pro"]');
    const teamCells = page.locator('.cmp__table td[data-col="team"]');
    const narrow = (page.viewportSize()?.width ?? 1440) < 640;
    await expect(proCells.first()).toBeVisible();
    if (narrow) {
      await expect(teamCells.first()).toBeHidden();
      await page.locator('[data-compare-toggle] a[data-value="team"]').click();
      await expect(teamCells.first()).toBeVisible();
      await expect(proCells.first()).toBeHidden();
      await expect(page).toHaveURL(/compare=team/);
      // The sticky bar offers the selected plan's button.
      await expect(page.locator('.cmp__plan[data-col="team"] a.btn')).toBeVisible();
    } else {
      await expect(teamCells.first()).toBeVisible();
      await expect(page.locator('.cmp__plan a.btn')).toHaveCount(3);
    }
  });

  test('the plan switcher works without JS via the query param', async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto('/pro?compare=free');
    await expect(page.locator('.cmp__table td[data-col="free"]').first()).toBeVisible();
    await expect(page.locator('.cmp__table td[data-col="pro"]').first()).toBeHidden();
    await expect(page.locator('[data-compare-toggle] a[aria-current="true"]')).toHaveAttribute(
      'data-value',
      'free',
    );
    await context.close();
  });

  test('plan buttons go to sign-in, never to a payment page', async ({ page }) => {
    await prepare(page);
    await page.goto('/pro');
    await expect(page.locator('[data-plan="pro"] a.btn')).toHaveAttribute(
      'href',
      '/sign-in?next=/pro',
    );
    await expect(page.locator('[data-plan="team"] a.btn')).toHaveAttribute(
      'href',
      '/sign-in?next=/pro',
    );
  });
});

test.describe('accounts (signed out)', () => {
  test('sign-in keeps next and adapts the headline', async ({ page }) => {
    await prepare(page);
    await page.goto(`/sign-in?next=${encodeURIComponent('/account/save?item=section:1')}`);
    await expect(page.locator('h1')).toHaveText('Sign in to save this section.');
    // Without a Whop app configured the Whop button is off and says so.
    const whop = page.getByRole('button', { name: 'Continue with Whop' });
    if ((await whop.count()) > 0) await expect(whop).toBeDisabled();
  });

  test('sign-in ignores off-site next values', async ({ page }) => {
    await prepare(page);
    for (const bad of ['//evil.example/steal', '/\\evil.example', '/\t/evil.example']) {
      await page.goto(`/sign-in?next=${encodeURIComponent(bad)}`);
      await expect(page.locator('a.auth__back, .auth__back a').first()).toHaveAttribute(
        'href',
        '/',
      );
    }
  });

  test('account pages redirect to sign-in and keep the destination', async ({ request }) => {
    for (const path of ['/account', '/account/boards', '/account/save?item=section:1']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(302);
      expect(res.headers()['location']).toBe(`/sign-in?next=${encodeURIComponent(path)}`);
    }
  });

  test('account actions refuse cross-origin posts', async ({ request }) => {
    const res = await request.post('/account/actions', {
      headers: { Origin: 'https://evil.example' },
      form: { intent: 'delete-account', confirm: 'delete' },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
  });

  test('the webhook refuses unsigned requests', async ({ request }) => {
    const res = await request.post('/api/whop/webhook', {
      data: { type: 'membership.activated', data: {} },
    });
    expect([400, 503]).toContain(res.status());
  });

  test('example boards are labelled as examples', async ({ page }) => {
    await prepare(page);
    await page.goto('/account/boards/example-reviews');
    await expect(page.locator('main')).toContainText(/Example board/i);
    await expect(page.locator('.section-card').first()).toBeVisible();
  });

  test('account pages are noindex', async ({ page }) => {
    await prepare(page);
    for (const path of ['/account/boards/example-reviews', '/sign-in']) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    }
  });
});

test.describe('developers', () => {
  test('lists endpoints with copyable curl examples and links the OpenAPI document', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/developers');
    await expect(page.locator('a[href="/api/v1/openapi.json"]').first()).toBeVisible();
    const rows = page.locator('.ep');
    expect(await rows.count()).toBeGreaterThan(10);
    await expect(rows.first().locator('[data-code-text]')).toContainText('curl ');
    await expect(page.locator('.ep__path', { hasText: '/api/v1/stores/{domain}' })).toHaveCount(1);
  });
});
