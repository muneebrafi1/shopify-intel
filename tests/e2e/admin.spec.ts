import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectHealthyPage } from './helpers';

/**
 * The protected admin. Runs against any server (E2E_BASE_URL). Signed-in tests need the server
 * to have ADMIN_PASSWORD + ADMIN_SESSION_SECRET (e.g. .dev.vars locally); the test reads the
 * password from ADMIN_PASSWORD and falls back to the local dev value. When the server has no
 * sign-in configured, the "locked" tests run instead and the signed-in ones are skipped.
 */
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'local-admin-dev-2026';

async function adminConfigured(request: APIRequestContext): Promise<boolean> {
  const res = await request.get('/admin/login');
  return res.status() !== 503;
}

/** Signs in through the real form endpoint (same-origin POST), sharing cookies with `page`. */
async function signIn(page: Page, baseURL: string) {
  const res = await page.request.post('/admin/login', {
    form: { password: PASSWORD },
    headers: { Origin: new URL(baseURL).origin },
    maxRedirects: 0,
  });
  expect(res.status(), 'sign-in should redirect').toBe(303);
}

test.describe('admin guard (signed out)', () => {
  test('public pages pass through the middleware untouched', async ({ request }) => {
    for (const path of ['/robots.txt', '/design-system', '/about']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers()['x-robots-tag'] ?? '', path).not.toContain('noindex, nofollow');
      expect(res.headers()['cache-control'] ?? '', path).not.toBe('no-store');
    }
    // Look-alike paths are not admin paths.
    for (const path of ['/administrator', '/admins']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
      expect(res.headers().location, path).toBeUndefined();
    }
  });

  test('admin pages redirect to sign-in with no-store and noindex', async ({ request }) => {
    const res = await request.get('/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe('/admin/login');
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');

    const deep = await request.get('/admin/stores?q=youngla', { maxRedirects: 0 });
    expect(deep.status()).toBe(302);
    expect(deep.headers().location).toMatch(/^\/admin\/login(\?next=%2Fadmin%2Fstores%3Fq%3Dyoungla)?$/);

    // Other spellings never serve admin content: they redirect to sign-in, or (trailing slash,
    // with trailingSlash: 'never') are not routed at all.
    for (const path of ['/ADMIN', '/%61dmin/stores', '/admin/']) {
      const variant = await request.get(path, { maxRedirects: 0 });
      expect([301, 302, 308, 404], path).toContain(variant.status());
      if (variant.status() !== 404) expect(variant.headers().location ?? '', path).toMatch(/\/admin/);
      expect(await variant.text(), path).not.toContain('admin-shell');
    }

    const login = await request.get('/admin/login');
    expect(login.headers()['cache-control']).toBe('no-store');
    expect(login.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(login.headers()['x-frame-options']).toBe('DENY');
  });

  test('admin API answers 401 JSON without a session', async ({ request }) => {
    const res = await request.get('/api/v1/admin/overview');
    expect(res.status()).toBe(401);
    expect(res.headers()['cache-control']).toBe('no-store');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  test('state-changing requests without a same-origin Origin are rejected', async ({ request }) => {
    const noOrigin = await request.post('/admin/login', { form: { password: PASSWORD }, maxRedirects: 0 });
    expect(noOrigin.status()).toBe(403);
    expect(noOrigin.headers()['set-cookie'] ?? '').not.toContain('admin_session');

    const crossSite = await request.post('/admin/login', {
      form: { password: PASSWORD },
      headers: { Origin: 'https://evil.example' },
      maxRedirects: 0,
    });
    expect(crossSite.status()).toBe(403);

    const api = await request.post('/api/v1/admin/stores', { data: { status: 'hidden' } });
    expect(api.status()).toBe(403);
  });

  test('the sign-in page is healthy', async ({ page, request }) => {
    const configured = await adminConfigured(request);
    await expectHealthyPage(page, '/admin/login', { status: configured ? 200 : 503 });
    if (!configured) {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admin is not configured');
    }
  });
});

test.describe('admin sign-in', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await adminConfigured(request)), 'Server has no admin sign-in configured (see .dev.vars.example).');
  });

  test('a wrong password is refused with a generic message', async ({ page, context }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill('definitely-not-the-password');
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/login') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    expect(response.status()).toBe(401);
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByText('That password is not correct.')).toBeVisible();
    expect((await context.cookies()).some((c) => c.name.endsWith('admin_session'))).toBe(false);
  });

  test('the right password signs in, returns to the page asked for, and signs out', async ({ page, context }) => {
    await page.goto('/admin/stores?q=youngla');
    await expect(page).toHaveURL(/\/admin\/login\?next=/);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/stores\?q=youngla$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Stores/);

    const cookie = (await context.cookies()).find((c) => c.name.endsWith('admin_session'));
    expect(cookie, 'session cookie').toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/');

    // Sign out from the sidebar (desktop) or the menu (mobile).
    const menu = page.getByLabel('Open admin menu');
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Sign out' }).locator('visible=true').click();
    await expect(page).toHaveURL(/\/admin\/login\?ok=signed_out/);
    await expect(page.getByText('You are signed out.')).toBeVisible();
    const res = await page.request.get('/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
  });
});

test.describe('admin pages (signed in)', () => {
  test.beforeEach(async ({ page, request, baseURL }) => {
    test.skip(!(await adminConfigured(request)), 'Server has no admin sign-in configured (see .dev.vars.example).');
    await signIn(page, baseURL!);
  });

  for (const path of [
    '/admin',
    '/admin/stores',
    '/admin/stores?curated=yes&captured=placeholder',
    '/admin/stores/youngla.com',
    '/admin/removals',
    '/admin/removals?status=approved',
    '/admin/removals?status=rejected',
    '/admin/scans',
    '/admin/scans?status=cancelled',
    '/admin/teardowns',
    '/admin/themes',
    '/admin/themes?edit=1',
    '/admin/apps',
    '/admin/affiliates',
    '/admin/affiliates?new=1',
  ]) {
    test(`healthy: ${path}`, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }

  test('unknown records return 404', async ({ page }) => {
    await expectHealthyPage(page, '/admin/stores/no-such-store.example', { status: 404 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Store not found');
    await expectHealthyPage(page, '/admin/removals/99999999', { status: 404 });
  });

  test('store filters change the results', async ({ page }) => {
    await page.goto('/admin/stores?q=youngla');
    await expect(page.locator('table.stores tbody tr')).toHaveCount(1);
    await expect(page.locator('table.stores tbody')).toContainText('youngla.com');

    await page.goto('/admin/stores?q=zzzz-no-such-store');
    await expect(page.getByText('No stores match these filters.')).toBeVisible();

    await page.goto('/admin/stores?curated=yes');
    const curated = await page.locator('table.stores tbody tr').count();
    expect(curated).toBeGreaterThan(0);
    expect(curated).toBeLessThan(50);
  });

  test('a signed-in POST still needs a same-origin Origin', async ({ page }) => {
    const res = await page.request.post('/admin/scans', {
      form: { intent: 'queue', domain: 'youngla.com', kind: 'rescan' },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    expect(await res.text()).toContain('Cross-origin request blocked');
  });

  test('queue a rescan from a store page, then cancel it from the queue', async ({ page }, testInfo) => {
    const domain = testInfo.project.name.includes('mobile') ? 'lskd.co' : 'thesill.com';
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto(`/admin/stores/${domain}`);
    await page.getByRole('button', { name: 'Queue rescan' }).click();
    await expect(page.getByRole('status')).toContainText(/Rescan queued|already queued/);

    await page.goto('/admin/scans');
    const row = page.locator('tr', { hasText: domain }).filter({ hasText: 'Rescan' });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: /Cancel job/ }).click();
    await expect(page.getByRole('status')).toContainText('Job cancelled.');
    await expect(page.locator('tr', { hasText: domain }).filter({ hasText: 'Rescan' })).toHaveCount(0);
  });

  test('review a removal request end to end', async ({ page, request }, testInfo) => {
    const mobile = testInfo.project.name.includes('mobile');
    // A domain that is not in the library, so approving only writes a tombstone.
    const domain = `e2e-${Date.now().toString(36)}-${mobile ? 'm' : 'd'}.example`;
    const created = await request.post('/api/v1/removal-requests', {
      data: {
        domain,
        email: `owner@${domain}`,
        reason: 'End-to-end test request. Safe to ignore.',
        scope: 'store',
      },
    });
    test.skip(created.status() === 429, 'Removal API rate limit reached for this IP; try again later.');
    expect(created.status()).toBe(201);
    const { data } = (await created.json()) as { data: { reference: string } };

    await page.goto('/admin/removals');
    const row = page.locator('tr', { hasText: data.reference });
    await expect(row).toContainText(domain);
    await row.getByRole('link', { name: 'Review' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(domain);
    await expect(page.getByText(`${domain} is not in the library.`)).toBeVisible();

    if (mobile) {
      await page.getByLabel('Reject with a note').fill('Could not verify ownership.');
      await page.getByRole('button', { name: 'Reject request' }).click();
      await expect(page.getByRole('status')).toContainText('Request rejected.');
      await page.goto('/admin/removals?status=rejected');
    } else {
      await page.getByLabel('I understand this cannot be undone.').check();
      await page.getByRole('button', { name: 'Approve and remove store' }).click();
      await expect(page.getByRole('status')).toContainText('Removal approved.');
      await page.goto('/admin/removals?status=approved');
    }
    await expect(page.locator('tr', { hasText: data.reference })).toHaveCount(1);
  });
});

test.describe('admin when sign-in is not configured', () => {
  test('stays locked: no session can be created', async ({ request, baseURL }) => {
    test.skip(await adminConfigured(request), 'Sign-in is configured on this server.');
    const login = await request.get('/admin/login');
    expect(login.status()).toBe(503);
    expect(await login.text()).toContain('Admin is not configured');
    const post = await request.post('/admin/login', {
      form: { password: PASSWORD },
      headers: { Origin: new URL(baseURL!).origin },
      maxRedirects: 0,
    });
    expect(post.status()).toBe(503);
    expect(post.headers()['set-cookie'] ?? '').not.toContain('admin_session');
    expect((await request.get('/admin', { maxRedirects: 0 })).headers().location).toBe('/admin/login');
  });
});
