import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { signWebhook } from '../../src/server/whop/webhook.ts';
import { expectHealthyPage, expectNoHorizontalOverflow, prepare } from './helpers';

/**
 * Signed-in accounts through the local dev sign-in (DEV_SIGN_IN=1 in .dev.vars; CI writes it).
 * Skipped when the server has no dev sign-in. Never talks to Whop: webhooks are signed locally
 * with the throwaway WHOP_WEBHOOK_SECRET from .dev.vars.
 */

const devVars = (() => {
  try {
    return readFileSync('.dev.vars', 'utf8');
  } catch {
    return '';
  }
})();
const devVar = (name: string) => new RegExp(`^${name}=(.+)$`, 'm').exec(devVars)?.[1]?.trim();

const unique = (tag: string) =>
  `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function devSignIn(page: Page, plan: 'free' | 'pro' | 'team', next = '/account') {
  const email = unique(plan);
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  const form = page.locator('form[data-dev-signin]');
  test.skip((await form.count()) === 0, 'dev sign-in is not enabled on this server');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('select[name="plan"]').selectOption(plan);
  await form.getByRole('button', { name: 'Dev sign-in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'));
  return email;
}

async function firstStore(page: Page): Promise<string> {
  const res = await page.request.get('/api/v1/stores?limit=1');
  const json = (await res.json()) as { data: { items: { domain: string }[] } };
  return json.data.items[0]!.domain;
}

test.describe('accounts (dev sign-in)', () => {
  test('a Pro user saves a store to a new board, exports, removes and deletes it', async ({
    page,
  }) => {
    await prepare(page);
    await devSignIn(page, 'pro');
    await expect(page.locator('[data-plan]')).toHaveAttribute('data-plan', 'pro');
    await expectNoHorizontalOverflow(page);

    const domain = await firstStore(page);
    await page.goto(`/stores/${domain}`);
    // Public page, cached for everyone: the header switches from the flag cookie.
    await expect(page.locator('a[data-auth-link]').first()).toHaveAttribute('href', '/account');
    await page.getByRole('link', { name: 'Save', exact: true }).first().click();
    await expect(page).toHaveURL(/\/account\/save\?item=store/);
    await expect(page.locator('h1')).toHaveText('Save this store');
    await expectNoHorizontalOverflow(page);
    await page.locator('input[name="board"][value="__new"]').check();
    await page.locator('input[name="name"]').fill('Pitch boards');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-saved] h1')).toContainText('Saved to “Pitch boards”');

    // Saving again says so instead of duplicating.
    await page.goto(`/account/save?item=store:${domain}&back=/stores/${domain}`);
    await page.locator('input[name="board"][value="pitch-boards"]').check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-saved] h1')).toContainText('Already on');

    await page.getByRole('link', { name: 'Open board' }).click();
    await expect(page).toHaveURL(/\/account\/boards\/pitch-boards/);
    await expect(page.locator('.bd__item')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);

    const csv = await page.request.get('/account/export/pitch-boards.csv');
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain(`/stores/${domain}`);

    await page.getByRole('button', { name: /^Remove / }).click();
    await expect(page.locator('main')).toContainText('Nothing on this board yet');
    await page.locator('summary', { hasText: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete board' }).click();
    await expect(page).toHaveURL(/\/account\/boards\?done=deleted/);
    await expect(page.locator('main')).toContainText('Board deleted.');
  });

  test('boards list and new board form work at this width', async ({ page }) => {
    await prepare(page);
    await devSignIn(page, 'team', '/account/boards');
    await expectHealthyPage(page, '/account/boards');
    await page.locator('summary', { hasText: 'New board' }).click();
    await page.locator('#board-name').fill('Hero ideas');
    await page.getByRole('button', { name: 'Create board' }).click();
    await expect(page).toHaveURL(/\/account\/boards\/hero-ideas\?done=created/);
    await page.goto('/account/boards');
    await expect(page.locator('[data-boards] .board')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });

  test('a Free user is offered Pro instead of boards', async ({ page }) => {
    await prepare(page);
    await devSignIn(page, 'free');
    await expect(page.locator('[data-plan]')).toHaveAttribute('data-plan', 'free');
    const domain = await firstStore(page);
    await page.goto(`/account/save?item=store:${domain}`);
    await expect(page.locator('h1')).toHaveText('Boards come with Pro');
    const res = await page.request.post('/account/actions', {
      form: { intent: 'create', name: 'Sneaky' },
      headers: { Origin: new URL(page.url()).origin },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    expect(res.headers()['location']).toBe('/account/boards?error=plan');
  });

  test('a signed Whop webhook turns a Free user into Pro and back', async ({ page }) => {
    const secret = devVar('WHOP_WEBHOOK_SECRET');
    const product = devVar('WHOP_PRO_PRODUCT_ID');
    test.skip(!secret || !product, 'no local webhook secret / product id in .dev.vars');
    await prepare(page);
    const email = await devSignIn(page, 'free');
    const { createHash } = await import('node:crypto');
    const userId = `user_dev${createHash('sha256').update(email).digest('hex').slice(0, 12)}`;
    const mem = `mem_E2E${Date.now().toString(36)}`;
    const send = async (status: string, id: string) => {
      const body = JSON.stringify({
        id: `evt_${id}`,
        type: status === 'active' ? 'membership.activated' : 'membership.deactivated',
        timestamp: new Date().toISOString(),
        data: {
          id: mem,
          status,
          user_id: userId,
          product_id: product,
          cancel_at_period_end: false,
        },
      });
      const ts = Math.floor(Date.now() / 1000);
      return page.request.post('/api/whop/webhook', {
        headers: {
          'content-type': 'application/json',
          'webhook-id': id,
          'webhook-timestamp': String(ts),
          'webhook-signature': await signWebhook(secret!, id, ts, body),
        },
        data: body,
      });
    };
    const a = await send('active', `msg_${mem}_a`);
    expect(await a.json()).toMatchObject({ ok: true, result: 'applied' });
    await page.goto('/account');
    await expect(page.locator('[data-plan]')).toHaveAttribute('data-plan', 'pro');
    await new Promise((r) => setTimeout(r, 1100));
    const d = await send('expired', `msg_${mem}_d`);
    expect(await d.json()).toMatchObject({ ok: true, result: 'applied' });
    await page.reload();
    await expect(page.locator('[data-plan]')).toHaveAttribute('data-plan', 'free');
  });

  test('signing out ends the session; deleting the account removes it', async ({ page }) => {
    await prepare(page);
    await devSignIn(page, 'pro');
    await page.getByRole('button', { name: 'Sign out' }).last().click();
    await expect(page).toHaveURL(/\/\?signed_out=1/);
    await expect(page.locator('a[data-auth-link]').first()).toHaveAttribute('href', '/sign-in');
    const res = await page.request.get('/account', { maxRedirects: 0 });
    expect(res.status()).toBe(302);

    await devSignIn(page, 'pro');
    await page.locator('summary', { hasText: 'Delete' }).click();
    await page.locator('#confirm-delete').fill('delete');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page).toHaveURL(/account_deleted=1/);
    expect((await page.request.get('/account', { maxRedirects: 0 })).status()).toBe(302);
  });
});
