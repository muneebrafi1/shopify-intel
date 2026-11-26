/**
 * Whop webhooks (Standard Webhooks signatures, fixtures signed with a throwaway local secret),
 * membership → plan, OAuth state cookies and code exchange (fake fetch), user sessions.
 * Nothing here talks to Whop.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleWhopWebhook } from '../../src/server/whop/handle.ts';
import { readMembership, signWebhook, verifyWebhook } from '../../src/server/whop/webhook.ts';
import {
  completeAuthorization,
  openState,
  sealState,
  startAuthorization,
} from '../../src/server/whop/oauth.ts';
import { readWhopConfig } from '../../src/server/whop/config.ts';
import { planFor } from '../../src/server/account/entitlements.ts';
import { upsertWhopUser } from '../../src/server/account/users.ts';
import { createSession, deleteSession, userForSession } from '../../src/server/account/sessions.ts';
import { FIXED_NOW, seededDb } from './helpers/db.ts';

const SECRET = 'ws_local_test_secret_not_a_real_key_0123456789';
const PRODUCTS = { pro: 'prod_TESTPRO', team: 'prod_TESTTEAM' };
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/whop/${name}.json`, import.meta.url), 'utf8');
const ts = (d: Date) => Math.floor(d.getTime() / 1000);

async function signed(body: string, id = 'msg_test_1', at = FIXED_NOW) {
  const t = ts(at);
  return new Headers({
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(t),
    'webhook-signature': await signWebhook(SECRET, id, t, body),
  });
}

describe('verifyWebhook', () => {
  it('accepts a correctly signed event', async () => {
    const body = fixture('membership-activated');
    const v = await verifyWebhook(body, await signed(body), SECRET, FIXED_NOW);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.event.type).toBe('membership.activated');
      expect(v.event.timestamp).toBe('2026-11-17T11:59:00.000Z');
    }
  });

  it('matches the Standard Webhooks reference vector', async () => {
    // standardwebhooks spec test: whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw (base64 key bytes).
    const key = new Uint8Array(Buffer.from('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'base64'));
    const sig = await signWebhook(
      key,
      'msg_p5jXN8AQM9LWM0D4loKWxJek',
      1614265330,
      '{"test": 2432232314}',
    );
    expect(sig).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('accepts any valid signature among several (rotation)', async () => {
    const body = '{"type":"x","data":{}}';
    const h = await signed(body);
    h.set('webhook-signature', `v1,AAAA ${h.get('webhook-signature')}`);
    expect((await verifyWebhook(body, h, SECRET, FIXED_NOW)).ok).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, and missing headers', async () => {
    const body = fixture('membership-activated');
    const h = await signed(body);
    const tampered = body.replace('"active"', '"trialing"');
    expect(await verifyWebhook(tampered, h, SECRET, FIXED_NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await verifyWebhook(body, h, 'ws_other', FIXED_NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await verifyWebhook(body, new Headers(), SECRET, FIXED_NOW)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('rejects timestamps outside five minutes', async () => {
    const body = fixture('membership-activated');
    const old = await signed(body, 'msg_old', new Date(FIXED_NOW.getTime() - 6 * 60_000));
    expect(await verifyWebhook(body, old, SECRET, FIXED_NOW)).toMatchObject({
      ok: false,
      reason: 'timestamp outside tolerance',
    });
    const near = await signed(body, 'msg_near', new Date(FIXED_NOW.getTime() - 4 * 60_000));
    expect((await verifyWebhook(body, near, SECRET, FIXED_NOW)).ok).toBe(true);
  });
});

describe('readMembership', () => {
  it('reads flat (current) and nested (older) membership shapes', () => {
    const flat = readMembership(JSON.parse(fixture('membership-activated')).data);
    const nested = readMembership(JSON.parse(fixture('membership-deactivated')).data);
    expect(flat).toMatchObject({
      id: 'mem_TESTPRO1',
      whopUserId: 'user_TESTA',
      productId: 'prod_TESTPRO',
      variantId: 'plan_TESTMONTHLY',
      status: 'active',
      currentPeriodEnd: '2026-12-17T11:58:00.000Z',
    });
    expect(nested).toMatchObject({
      whopUserId: 'user_TESTA',
      productId: 'prod_TESTPRO',
      status: 'expired',
    });
    expect(readMembership({ id: 'pay_1', status: 'paid' })).toBeNull();
  });

  it('drops non-https manage URLs', () => {
    const data = {
      ...JSON.parse(fixture('membership-activated')).data,
      manage_url: 'javascript:x',
    };
    expect(readMembership(data)?.manageUrl).toBeNull();
  });
});

describe('planFor', () => {
  it('maps statuses and products to a plan', () => {
    expect(planFor([], PRODUCTS)).toBe('free');
    expect(planFor([{ productId: 'prod_TESTPRO', status: 'active' }], PRODUCTS)).toBe('pro');
    expect(planFor([{ productId: 'prod_TESTPRO', status: 'canceling' }], PRODUCTS)).toBe('pro');
    expect(planFor([{ productId: 'prod_TESTPRO', status: 'past_due' }], PRODUCTS)).toBe('pro');
    expect(planFor([{ productId: 'prod_TESTPRO', status: 'expired' }], PRODUCTS)).toBe('free');
    expect(planFor([{ productId: 'prod_OTHER', status: 'active' }], PRODUCTS)).toBe('free');
    expect(
      planFor(
        [
          { productId: 'prod_TESTPRO', status: 'active' },
          { productId: 'prod_TESTTEAM', status: 'trialing' },
        ],
        PRODUCTS,
      ),
    ).toBe('team');
    expect(
      planFor([{ productId: 'prod_TESTPRO', status: 'active' }], { pro: null, team: null }),
    ).toBe('free');
  });
});

describe('handleWhopWebhook', () => {
  const plan = (db: ReturnType<typeof seededDb>) =>
    db.first<{ plan: string }>("SELECT plan FROM users WHERE whop_user_id = 'user_TESTA'");

  it('activates, dedupes, ignores stale events and deactivates', async () => {
    const db = seededDb();
    await upsertWhopUser(
      db,
      { whopUserId: 'user_TESTA', email: 'a@example.com', name: 'A' },
      PRODUCTS,
      FIXED_NOW,
    );
    expect((await plan(db))?.plan).toBe('free');

    const run = async (name: string, id: string) => {
      const body = fixture(name);
      return handleWhopWebhook({
        db,
        rawBody: body,
        headers: await signed(body, id),
        secret: SECRET,
        products: PRODUCTS,
        now: FIXED_NOW,
      });
    };
    expect(await run('membership-activated', 'msg_a')).toEqual({ status: 200, result: 'applied' });
    expect((await plan(db))?.plan).toBe('pro');
    expect(await run('membership-activated', 'msg_a')).toEqual({
      status: 200,
      result: 'duplicate',
    });
    expect(await run('payment-succeeded', 'msg_p')).toEqual({ status: 200, result: 'ignored' });

    expect(await run('membership-deactivated', 'msg_d')).toEqual({
      status: 200,
      result: 'applied',
    });
    expect((await plan(db))?.plan).toBe('free');
    // The older "activated" event redelivered under a new id must not undo the deactivation.
    expect(await run('membership-activated', 'msg_a2')).toEqual({ status: 200, result: 'stale' });
    expect((await plan(db))?.plan).toBe('free');
  });

  it('keeps a membership that arrives before sign-in and applies it on first sign-in', async () => {
    const db = seededDb();
    const body = fixture('membership-activated');
    await handleWhopWebhook({
      db,
      rawBody: body,
      headers: await signed(body),
      secret: SECRET,
      products: PRODUCTS,
      now: FIXED_NOW,
    });
    await upsertWhopUser(
      db,
      { whopUserId: 'user_TESTA', email: null, name: null },
      PRODUCTS,
      FIXED_NOW,
    );
    const u = await db.first<{ plan: string; email: string }>(
      "SELECT plan, email FROM users WHERE whop_user_id = 'user_TESTA'",
    );
    expect(u).toEqual({ plan: 'pro', email: 'user_testa@users.whop.invalid' });
  });

  it('answers 503 without a secret and 401 for a bad signature', async () => {
    const db = seededDb();
    const body = fixture('membership-activated');
    const h = await signed(body);
    expect(
      (await handleWhopWebhook({ db, rawBody: body, headers: h, secret: null, products: PRODUCTS }))
        .status,
    ).toBe(503);
    expect(
      (
        await handleWhopWebhook({
          db,
          rawBody: body,
          headers: h,
          secret: 'ws_wrong',
          products: PRODUCTS,
          now: FIXED_NOW,
        })
      ).status,
    ).toBe(401);
    expect(await db.first('SELECT id FROM whop_memberships')).toBeNull();
  });
});

describe('OAuth helpers', () => {
  const stateSecret = 'x'.repeat(40);

  it('builds an authorize URL with PKCE and seals the state', async () => {
    const { url, cookie } = await startAuthorization({
      apiOrigin: 'https://api.whop.com',
      clientId: 'app_TEST',
      redirectUri: 'http://127.0.0.1:4321/auth/whop/callback',
      next: '/account',
      stateSecret,
      now: FIXED_NOW,
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://api.whop.com/oauth/authorize');
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const st = await openState(cookie, stateSecret, FIXED_NOW);
    expect(st?.state).toBe(u.searchParams.get('state'));
    expect(st?.next).toBe('/account');
    // Challenge = base64url(sha256(verifier))
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(st!.verifier)),
    );
    expect(u.searchParams.get('code_challenge')).toBe(Buffer.from(digest).toString('base64url'));
  });

  it('rejects tampered, foreign and expired state cookies', async () => {
    const st = { state: 's', verifier: 'v', next: '/', exp: ts(FIXED_NOW) + 60 };
    const c = await sealState(st, stateSecret);
    expect(await openState(c, stateSecret, FIXED_NOW)).toEqual(st);
    expect(await openState(c, 'y'.repeat(40), FIXED_NOW)).toBeNull();
    expect(await openState(`${c.slice(0, -2)}AA`, stateSecret, FIXED_NOW)).toBeNull();
    expect(await openState(c, stateSecret, new Date(FIXED_NOW.getTime() + 61_000))).toBeNull();
    expect(await openState('garbage', stateSecret, FIXED_NOW)).toBeNull();
  });

  it('exchanges the code and reads userinfo', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth/token'))
        return new Response(
          JSON.stringify({ access_token: 'at_1', token_type: 'Bearer', expires_in: 3600 }),
        );
      return new Response(
        JSON.stringify({
          sub: 'user_TESTA',
          name: 'Test Person',
          email: 'A@Example.com',
          email_verified: true,
        }),
      );
    };
    const who = await completeAuthorization({
      apiOrigin: 'https://api.whop.com',
      clientId: 'app_TEST',
      clientSecret: null,
      redirectUri: 'http://127.0.0.1/cb',
      code: 'code_1',
      verifier: 'ver_1',
      fetch: fake,
    });
    expect(who).toEqual({ whopUserId: 'user_TESTA', email: 'a@example.com', name: 'Test Person' });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code_1',
      code_verifier: 'ver_1',
      client_id: 'app_TEST',
    });
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBe('Bearer at_1');
  });

  it('fails closed on a bad token response or a missing user id', async () => {
    const base = {
      apiOrigin: 'https://api.whop.com',
      clientId: 'a',
      clientSecret: null,
      redirectUri: 'r',
      code: 'c',
      verifier: 'v',
    };
    await expect(
      completeAuthorization({ ...base, fetch: async () => new Response('no', { status: 400 }) }),
    ).rejects.toThrow('token exchange failed (400)');
    await expect(
      completeAuthorization({
        ...base,
        fetch: async (url) =>
          new Response(url.endsWith('/token') ? '{"access_token":"t"}' : '{"sub":"nope"}'),
      }),
    ).rejects.toThrow('without a Whop user id');
  });
});

describe('readWhopConfig', () => {
  it('is off without variables and only accepts https checkout links', () => {
    const off = readWhopConfig({});
    expect(off.oauth).toBeNull();
    expect(off.webhookSecret).toBeNull();
    expect(off.devSignIn).toBe(false);
    const on = readWhopConfig({
      WHOP_CLIENT_ID: 'app_X',
      USER_SESSION_SECRET: 'z'.repeat(32),
      WHOP_CHECKOUT_PRO_MONTHLY: 'https://whop.com/checkout/plan_X',
      WHOP_CHECKOUT_PRO_YEARLY: 'http://insecure.example',
      WHOP_ENVIRONMENT: 'sandbox',
    });
    expect(on.oauth).toEqual({ clientId: 'app_X', clientSecret: null });
    expect(on.apiOrigin).toBe('https://sandbox-api.whop.com');
    expect(on.checkout['pro-monthly']).toBe('https://whop.com/checkout/plan_X');
    expect(on.checkout['pro-yearly']).toBeNull();
    expect(
      readWhopConfig({ WHOP_CLIENT_ID: 'app_X', USER_SESSION_SECRET: 'short' }).oauth,
    ).toBeNull();
  });
});

describe('user sessions', () => {
  it('creates, reads, expires and deletes sessions', async () => {
    const db = seededDb();
    const id = await upsertWhopUser(
      db,
      { whopUserId: 'user_S', email: 's@example.com', name: 'S' },
      PRODUCTS,
      FIXED_NOW,
    );
    const { token } = await createSession(db, id, FIXED_NOW);
    expect(await userForSession(db, token, FIXED_NOW)).toMatchObject({
      id,
      email: 's@example.com',
      plan: 'free',
    });
    const stored = await db.first<{ token_hash: string }>('SELECT token_hash FROM user_sessions');
    expect(stored?.token_hash).not.toContain(token);
    expect(
      await userForSession(db, token, new Date(FIXED_NOW.getTime() + 31 * 86_400_000)),
    ).toBeNull();
    expect(await userForSession(db, 'x'.repeat(43), FIXED_NOW)).toBeNull();
    await deleteSession(db, token);
    expect(await userForSession(db, token, FIXED_NOW)).toBeNull();
  });

  it('links an existing email account to the Whop id', async () => {
    const db = seededDb();
    await db.run(
      "INSERT INTO users (email, plan, created_at, updated_at) VALUES ('old@example.com', 'free', 'x', 'x')",
    );
    const id = await upsertWhopUser(
      db,
      { whopUserId: 'user_OLD', email: 'old@example.com', name: null },
      PRODUCTS,
      FIXED_NOW,
    );
    expect(await db.first('SELECT COUNT(*) AS n FROM users')).toEqual({ n: 1 });
    expect(await db.first('SELECT whop_user_id FROM users WHERE id = ?', [id])).toEqual({
      whop_user_id: 'user_OLD',
    });
  });
});
