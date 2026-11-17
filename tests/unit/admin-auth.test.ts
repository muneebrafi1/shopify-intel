/// <reference types="node" />
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createAccessVerifier,
  normalizeTeamDomain,
  type KeyCache,
} from '../../src/server/auth/access.ts';
import { readAuthConfig } from '../../src/server/auth/config.ts';
import { base64UrlEncode, secretsEqual, utf8 } from '../../src/server/auth/crypto.ts';
import {
  adminAreaFor,
  authenticate,
  isSameOrigin,
  safeNextPath,
  sessionCookieName,
  sessionCookieOptions,
  withAdminHeaders,
} from '../../src/server/auth/guard.ts';
import {
  hashClientIp,
  loginAttemptStatement,
  loginRateLimit,
  MAX_FAILURES_PER_IP,
} from '../../src/server/auth/rate-limit.ts';
import { signSession, verifySession, SESSION_TTL_SECONDS } from '../../src/server/auth/session.ts';
import { openNodeDb } from '../../src/server/db/node-sqlite.ts';
import { migrationsSql } from './helpers/db.ts';

const SECRETS = {
  secret: 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  password: 'correct horse battery',
};
const NOW = new Date('2026-11-17T12:00:00.000Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe('admin session tokens', () => {
  it('round-trips a freshly signed token', async () => {
    const { token, payload } = await signSession(SECRETS, NOW);
    expect(token).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
    await expect(verifySession(token, SECRETS, later(60))).resolves.toEqual(payload);
  });

  it('expires after 12 hours', async () => {
    const { token } = await signSession(SECRETS, NOW);
    expect(await verifySession(token, SECRETS, later(SESSION_TTL_SECONDS - 1))).not.toBeNull();
    expect(await verifySession(token, SECRETS, later(SESSION_TTL_SECONDS))).toBeNull();
  });

  it('rejects a tampered payload or signature', async () => {
    const { token } = await signSession(SECRETS, NOW);
    const [v, body, sig] = token.split('.') as [string, string, string];
    const forged = base64UrlEncode(utf8(JSON.stringify({ iat: 1, exp: 9_999_999_999, jti: 'x' })));
    expect(await verifySession(`${v}.${forged}.${sig}`, SECRETS, NOW)).toBeNull();
    const flipped = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
    expect(await verifySession(`${v}.${body}.${flipped}`, SECRETS, NOW)).toBeNull();
  });

  it('is invalidated by rotating the secret or the password', async () => {
    const { token } = await signSession(SECRETS, NOW);
    expect(
      await verifySession(token, { ...SECRETS, secret: `${SECRETS.secret}-rotated` }, NOW),
    ).toBeNull();
    expect(await verifySession(token, { ...SECRETS, password: 'a new password' }, NOW)).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    for (const bad of [
      null,
      undefined,
      '',
      'v1',
      'v1..',
      'v2.a.b',
      'v1.a.b.c',
      'v1.!!.??',
      'x'.repeat(600),
    ]) {
      await expect(verifySession(bad, SECRETS, NOW)).resolves.toBeNull();
    }
  });

  it('rejects tokens issued in the future or with an over-long lifetime', async () => {
    const future = await signSession(SECRETS, later(3600));
    expect(await verifySession(future.token, SECRETS, NOW)).toBeNull();
    const long = await signSession(SECRETS, NOW, SESSION_TTL_SECONDS * 2);
    expect(await verifySession(long.token, SECRETS, later(10))).toBeNull();
  });
});

describe('secretsEqual', () => {
  it('compares exactly, including length and case', async () => {
    expect(await secretsEqual('correct horse battery', 'correct horse battery')).toBe(true);
    expect(await secretsEqual('correct horse batter', 'correct horse battery')).toBe(false);
    expect(await secretsEqual('Correct horse battery', 'correct horse battery')).toBe(false);
    expect(await secretsEqual('', 'correct horse battery')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Cloudflare Access JWTs, signed with a locally generated RSA key
// ---------------------------------------------------------------------------------------------
const TEAM = 'acme.cloudflareaccess.com';
const AUD = 'aud-tag-1234567890';
const KID = 'test-key-1';
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
type Jwk = JsonWebKey & { kid?: string };
let publicJwk: JsonWebKey;

async function rsaPair() {
  return (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

async function signJwt(
  claims: Record<string, unknown>,
  opts: { key?: CryptoKey; header?: Record<string, unknown> } = {},
): Promise<string> {
  const header = opts.header ?? { alg: 'RS256', kid: KID, typ: 'JWT' };
  const h = base64UrlEncode(utf8(JSON.stringify(header)));
  const p = base64UrlEncode(utf8(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    opts.key ?? privateKey,
    utf8(`${h}.${p}`),
  );
  return `${h}.${p}.${base64UrlEncode(sig)}`;
}

const nowSec = Math.floor(NOW.getTime() / 1000);
const goodClaims = () => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  email: 'owner@example.com',
  sub: 'user-1',
  iat: nowSec - 60,
  nbf: nowSec - 60,
  exp: nowSec + 3600,
});

function verifier(opts: { keys?: () => Jwk[]; calls?: { n: number } } = {}) {
  const cache: KeyCache = new Map();
  return createAccessVerifier({
    teamDomain: 'acme',
    aud: AUD,
    now: () => NOW,
    cache,
    fetchCerts: async (url) => {
      expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
      if (opts.calls) opts.calls.n++;
      const keys = opts.keys ? opts.keys() : [{ ...publicJwk, kid: KID, alg: 'RS256' }];
      return { keys: keys as never };
    },
  });
}

beforeAll(async () => {
  const pair = await rsaPair();
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  otherPrivateKey = (await rsaPair()).privateKey;
});

describe('Cloudflare Access verifier', () => {
  it('normalises the team domain and refuses anything else', () => {
    expect(normalizeTeamDomain('acme')).toBe(TEAM);
    expect(normalizeTeamDomain('https://acme.cloudflareaccess.com/')).toBe(TEAM);
    expect(normalizeTeamDomain('ACME.cloudflareaccess.com')).toBe(TEAM);
    expect(normalizeTeamDomain('evil.example.com')).toBeNull();
    expect(normalizeTeamDomain('acme.cloudflareaccess.com.evil.com')).toBeNull();
  });

  it('accepts a valid token and returns the email', async () => {
    const identity = await verifier().verify(await signJwt(goodClaims()));
    expect(identity).toEqual({ actor: 'owner@example.com', exp: nowSec + 3600 });
  });

  it('accepts a string aud and service tokens (common_name)', async () => {
    const { email: _email, ...rest } = goodClaims();
    const identity = await verifier().verify(
      await signJwt({ ...rest, aud: AUD, common_name: 'ci-bot.access' }),
    );
    expect(identity?.actor).toBe('ci-bot.access');
  });

  it('rejects a wrong audience, issuer, or an expired / not-yet-valid token', async () => {
    const v = verifier();
    expect(await v.verify(await signJwt({ ...goodClaims(), aud: ['someone-else'] }))).toBeNull();
    expect(
      await v.verify(await signJwt({ ...goodClaims(), iss: 'https://other.cloudflareaccess.com' })),
    ).toBeNull();
    expect(await v.verify(await signJwt({ ...goodClaims(), exp: nowSec - 1 }))).toBeNull();
    expect(await v.verify(await signJwt({ ...goodClaims(), nbf: nowSec + 600 }))).toBeNull();
    const { exp: _exp, ...noExp } = goodClaims();
    expect(await v.verify(await signJwt(noExp))).toBeNull();
  });

  it('rejects tokens signed by another key or with a tampered payload', async () => {
    const v = verifier();
    expect(await v.verify(await signJwt(goodClaims(), { key: otherPrivateKey }))).toBeNull();
    const token = await signJwt(goodClaims());
    const [h, , s] = token.split('.') as [string, string, string];
    const forged = base64UrlEncode(
      utf8(JSON.stringify({ ...goodClaims(), email: 'attacker@example.com' })),
    );
    expect(await v.verify(`${h}.${forged}.${s}`)).toBeNull();
  });

  it('pins RS256: alg none and HS256 are refused', async () => {
    const v = verifier();
    const p = base64UrlEncode(utf8(JSON.stringify(goodClaims())));
    const none = base64UrlEncode(utf8(JSON.stringify({ alg: 'none', kid: KID })));
    expect(await v.verify(`${none}.${p}.`)).toBeNull();
    const hs = await signJwt(goodClaims(), { header: { alg: 'HS256', kid: KID } });
    expect(await v.verify(hs)).toBeNull();
  });

  it('caches keys and refetches (rate limited) for an unknown kid', async () => {
    const calls = { n: 0 };
    let keys: Jwk[] = [{ ...publicJwk, kid: 'old-key', alg: 'RS256' }];
    const v = verifier({ keys: () => keys, calls });
    // Unknown kid on an empty cache → one fetch, still unknown → denied.
    expect(await v.verify(await signJwt(goodClaims()))).toBeNull();
    expect(calls.n).toBe(1);
    // Rotation: the new kid is published, but the cache refetches at most every 30 s.
    keys = [{ ...publicJwk, kid: KID, alg: 'RS256' }];
    expect(await v.verify(await signJwt(goodClaims()))).toBeNull();
    expect(calls.n).toBe(1);
  });

  it('serves repeated verifications from the key cache', async () => {
    const calls = { n: 0 };
    const v = verifier({ calls });
    for (let i = 0; i < 3; i++) expect(await v.verify(await signJwt(goodClaims()))).not.toBeNull();
    expect(calls.n).toBe(1);
  });

  it('denies (never throws) when the certs endpoint fails', async () => {
    const v = createAccessVerifier({
      teamDomain: TEAM,
      aud: AUD,
      now: () => NOW,
      cache: new Map(),
      fetchCerts: async () => {
        throw new Error('network down');
      },
    });
    expect(await v.verify(await signJwt(goodClaims()))).toBeNull();
    expect(await v.verify('not.a.jwt')).toBeNull();
    expect(await v.verify(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------------------------
describe('adminAreaFor', () => {
  it('leaves public paths alone', () => {
    for (const p of [
      '/',
      '/stores',
      '/stores/admin.com',
      '/apps/admin-tools',
      '/administrator',
      '/admins',
      '/api/v1/stores',
      '/api/v1/administer',
      '/robots.txt',
    ]) {
      expect(adminAreaFor(p), p).toBeNull();
    }
  });

  it('guards every spelling of the admin paths', () => {
    expect(adminAreaFor('/admin')).toBe('page');
    expect(adminAreaFor('/admin/')).toBe('page');
    expect(adminAreaFor('/admin/stores/youngla.com')).toBe('page');
    expect(adminAreaFor('/ADMIN/Stores')).toBe('page');
    expect(adminAreaFor('/%61dmin')).toBe('page');
    expect(adminAreaFor('//admin')).toBe('page');
    expect(adminAreaFor('/admin.html')).toBe('page');
    expect(adminAreaFor('/admin/login')).toBe('login');
    expect(adminAreaFor('/admin/login/')).toBe('login');
    expect(adminAreaFor('/admin/logout')).toBe('logout');
    expect(adminAreaFor('/api/v1/admin')).toBe('api');
    expect(adminAreaFor('/api/v1/admin/overview')).toBe('api');
    expect(adminAreaFor('/api/v1/%61dmin/x')).toBe('api');
  });
});

describe('isSameOrigin', () => {
  const url = new URL('https://shop.example/admin/stores');
  const req = (headers: Record<string, string>) => new Request(url, { method: 'POST', headers });
  it('requires a matching Origin', () => {
    expect(isSameOrigin(req({ origin: 'https://shop.example' }), url)).toBe(true);
    expect(isSameOrigin(req({}), url)).toBe(false);
    expect(isSameOrigin(req({ origin: 'null' }), url)).toBe(false);
    expect(isSameOrigin(req({ origin: 'https://evil.example' }), url)).toBe(false);
    expect(isSameOrigin(req({ origin: 'http://shop.example' }), url)).toBe(false);
  });
  it('honours Sec-Fetch-Site when the browser sends it', () => {
    expect(
      isSameOrigin(req({ origin: 'https://shop.example', 'sec-fetch-site': 'same-origin' }), url),
    ).toBe(true);
    expect(
      isSameOrigin(req({ origin: 'https://shop.example', 'sec-fetch-site': 'same-site' }), url),
    ).toBe(false);
    expect(
      isSameOrigin(req({ origin: 'https://shop.example', 'sec-fetch-site': 'cross-site' }), url),
    ).toBe(false);
  });
});

describe('safeNextPath', () => {
  const origin = 'https://shop.example';
  it('allows same-origin admin pages only', () => {
    expect(safeNextPath('/admin/stores?q=a', origin)).toBe('/admin/stores?q=a');
    expect(safeNextPath(null, origin)).toBe('/admin');
    for (const bad of [
      '//evil.example/admin',
      'https://evil.example/admin',
      '/\\evil.example',
      '/stores',
      '/admin/login',
      'javascript:alert(1)',
      '/admin/\u0000x',
    ]) {
      expect(safeNextPath(bad, origin), bad).toBe('/admin');
    }
  });
});

describe('cookies and headers', () => {
  it('uses a __Host- Secure cookie except on local http', () => {
    const prod = new URL('https://shop.example/admin');
    const local = new URL('http://127.0.0.1:4321/admin');
    expect(sessionCookieName(prod)).toBe('__Host-admin_session');
    expect(sessionCookieOptions(prod, 60)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    expect(sessionCookieName(local)).toBe('admin_session');
    expect(sessionCookieOptions(local, 60).secure).toBe(false);
  });

  it('adds no-store / noindex even to redirects with immutable headers', () => {
    const res = withAdminHeaders(Response.redirect('https://shop.example/admin/login', 302));
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('readAuthConfig', () => {
  const secret = 'x'.repeat(40);
  it('is locked when nothing is configured', () => {
    expect(readAuthConfig({}).mode).toBe('locked');
    expect(readAuthConfig({ ADMIN_PASSWORD: '   ', ADMIN_SESSION_SECRET: '' }).mode).toBe('locked');
  });
  it('is locked when only half of a pair is set or values are weak', () => {
    expect(readAuthConfig({ ADMIN_PASSWORD: 'long enough pw' }).mode).toBe('locked');
    expect(readAuthConfig({ ADMIN_SESSION_SECRET: secret }).mode).toBe('locked');
    expect(readAuthConfig({ ADMIN_PASSWORD: 'short', ADMIN_SESSION_SECRET: secret }).mode).toBe(
      'locked',
    );
    expect(
      readAuthConfig({ ADMIN_PASSWORD: 'long enough pw', ADMIN_SESSION_SECRET: 'tiny' }).mode,
    ).toBe('locked');
    expect(readAuthConfig({ CF_ACCESS_TEAM_DOMAIN: 'acme' }).mode).toBe('locked');
    expect(
      readAuthConfig({ CF_ACCESS_TEAM_DOMAIN: 'evil.example.com', CF_ACCESS_AUD: AUD }).mode,
    ).toBe('locked');
  });
  it('keeps the password as a break-glass next to Cloudflare Access (owner decision)', () => {
    const cfg = readAuthConfig({
      CF_ACCESS_TEAM_DOMAIN: 'acme',
      CF_ACCESS_AUD: AUD,
      ADMIN_PASSWORD: 'long enough pw',
      ADMIN_SESSION_SECRET: secret,
    });
    expect(cfg).toEqual({
      mode: 'password',
      password: 'long enough pw',
      secret,
      access: { teamDomain: TEAM, aud: AUD },
    });
    // Without the password pair (or with a weak one), Access is the only method; a broken
    // backup never locks Access out.
    expect(readAuthConfig({ CF_ACCESS_TEAM_DOMAIN: 'acme', CF_ACCESS_AUD: AUD })).toEqual({
      mode: 'access',
      teamDomain: TEAM,
      aud: AUD,
    });
    expect(
      readAuthConfig({ CF_ACCESS_TEAM_DOMAIN: 'acme', CF_ACCESS_AUD: AUD, ADMIN_PASSWORD: 'short' })
        .mode,
    ).toBe('access');
  });
  it('uses the password when configured', () => {
    expect(
      readAuthConfig({ ADMIN_PASSWORD: 'long enough pw', ADMIN_SESSION_SECRET: secret }).mode,
    ).toBe('password');
  });
});

describe('authenticate', () => {
  const url = new URL('https://shop.example/admin');
  it('reads the password session cookie', async () => {
    const config = { mode: 'password' as const, ...SECRETS };
    const { token } = await signSession(SECRETS);
    const ok = await authenticate({
      config,
      request: new Request(url),
      url,
      getCookie: (n) => (n === '__Host-admin_session' ? token : undefined),
    });
    expect(ok).toMatchObject({ method: 'password', actor: 'admin' });
    const wrongName = await authenticate({
      config,
      request: new Request(url),
      url,
      getCookie: (n) => (n === 'admin_session' ? token : undefined),
    });
    expect(wrongName).toBeNull();
  });

  it('reads the Access header and never falls back to the password cookie', async () => {
    const config = { mode: 'access' as const, teamDomain: TEAM, aud: AUD };
    const fetchCerts = async () => ({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256' }] as never });
    const jwt = await signJwt(goodClaims());
    const request = new Request(url, { headers: { 'cf-access-jwt-assertion': jwt } });
    expect(
      await authenticate({
        config,
        request,
        url,
        getCookie: () => undefined,
        now: NOW,
        fetchCerts,
      }),
    ).toMatchObject({
      method: 'access',
      actor: 'owner@example.com',
    });
    const { token } = await signSession(SECRETS);
    expect(
      await authenticate({
        config,
        request: new Request(url),
        url,
        getCookie: () => token,
        now: NOW,
        fetchCerts,
      }),
    ).toBeNull();
  });

  it('with Access and the break-glass password, checks Access first, then the cookie', async () => {
    const config = {
      mode: 'password' as const,
      ...SECRETS,
      access: { teamDomain: TEAM, aud: AUD },
    };
    const fetchCerts = async () => ({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256' }] as never });
    const jwt = await signJwt(goodClaims());
    const viaAccess = await authenticate({
      config,
      request: new Request(url, { headers: { 'cf-access-jwt-assertion': jwt } }),
      url,
      getCookie: () => undefined,
      now: NOW,
      fetchCerts,
    });
    expect(viaAccess).toMatchObject({ method: 'access', actor: 'owner@example.com' });
    const { token } = await signSession(SECRETS, NOW);
    const viaPassword = await authenticate({
      config,
      request: new Request(url),
      url,
      getCookie: (n) => (n === '__Host-admin_session' ? token : undefined),
      now: NOW,
      fetchCerts,
    });
    expect(viaPassword).toMatchObject({ method: 'password', actor: 'admin' });
    expect(
      await authenticate({
        config,
        request: new Request(url),
        url,
        getCookie: () => undefined,
        now: NOW,
        fetchCerts,
      }),
    ).toBeNull();
  });

  it('never authenticates when locked', async () => {
    const config = { mode: 'locked' as const, reason: 'x' };
    expect(
      await authenticate({ config, request: new Request(url), url, getCookie: () => 'anything' }),
    ).toBeNull();
  });
});

describe('login rate limit', () => {
  it('blocks an IP after repeated failures and resets after a success', async () => {
    const db = openNodeDb();
    db.raw.exec(migrationsSql());
    const ip = await hashClientIp('203.0.113.7', 'salt');
    const other = await hashClientIp('198.51.100.2', 'salt');
    expect(ip).toMatch(/^[0-9a-f]{32}$/);
    expect(ip).not.toBe(other);

    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) {
      expect((await loginRateLimit(db, ip, later(i))).blocked).toBe(false);
      await db.batch([loginAttemptStatement(false, ip, later(i))]);
    }
    const blocked = await loginRateLimit(db, ip, later(10));
    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await loginRateLimit(db, other, later(10))).blocked).toBe(false);
    // The window passes.
    expect((await loginRateLimit(db, ip, later(16 * 60))).blocked).toBe(false);
    // A success (e.g. from the owner after the window) resets the per-IP count.
    await db.batch([loginAttemptStatement(true, ip, later(16 * 60))]);
    expect((await loginRateLimit(db, ip, later(16 * 60 + 1))).blocked).toBe(false);
    db.close();
  });
});
