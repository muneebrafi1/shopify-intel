/**
 * "Sign in with Whop": OAuth 2.1 + PKCE with OpenID Connect, per
 * https://docs.whop.com/developer/guides/oauth (authorize, token and userinfo endpoints under
 * <apiOrigin>/oauth/). The PKCE verifier, state and `next` path travel in a short-lived signed
 * cookie (HMAC with USER_SESSION_SECRET), so no server state is kept before the callback.
 * Access and refresh tokens are used once, to read the user's id/email/name, and not stored.
 */
import {
  base64UrlDecode,
  base64UrlEncode,
  fromUtf8,
  hmacKey,
  hmacSign,
  parseJsonObject,
  sha256,
  utf8,
} from '../auth/crypto.ts';

export const STATE_COOKIE = 'vt_oauth';
export const STATE_TTL_SECONDS = 10 * 60;
export const SCOPES = 'openid profile email';

export interface OAuthState {
  state: string;
  verifier: string;
  next: string;
  exp: number;
}

const random = (n: number) => base64UrlEncode(crypto.getRandomValues(new Uint8Array(n)));

export async function startAuthorization(opts: {
  apiOrigin: string;
  clientId: string;
  redirectUri: string;
  next: string;
  stateSecret: string;
  now?: Date;
}): Promise<{ url: string; cookie: string }> {
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const st: OAuthState = {
    state: random(16),
    verifier: random(32),
    next: opts.next,
    exp: now + STATE_TTL_SECONDS,
  };
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: SCOPES,
    state: st.state,
    nonce: random(16),
    code_challenge: base64UrlEncode(await sha256(st.verifier)),
    code_challenge_method: 'S256',
  });
  return {
    url: `${opts.apiOrigin}/oauth/authorize?${params}`,
    cookie: await sealState(st, opts.stateSecret),
  };
}

async function key(secret: string) {
  return hmacKey(await hmacSign(await hmacKey(secret), 'vitrine-oauth-state:v1'));
}

export async function sealState(st: OAuthState, secret: string): Promise<string> {
  const body = base64UrlEncode(utf8(JSON.stringify(st)));
  return `${body}.${base64UrlEncode(await hmacSign(await key(secret), body))}`;
}

/** The state cookie's payload when its MAC is valid and it has not expired; else null. */
export async function openState(
  cookie: string | undefined | null,
  secret: string,
  now: Date = new Date(),
): Promise<OAuthState | null> {
  if (!cookie || cookie.length > 1024) return null;
  const [body, sigText] = cookie.split('.');
  if (!body || !sigText) return null;
  const sig = base64UrlDecode(sigText);
  if (!sig || sig.length !== 32) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(secret), sig, utf8(body));
  if (!ok) return null;
  const raw = base64UrlDecode(body);
  const d = raw ? parseJsonObject(fromUtf8(raw)) : null;
  if (
    !d ||
    typeof d.state !== 'string' ||
    typeof d.verifier !== 'string' ||
    typeof d.next !== 'string' ||
    typeof d.exp !== 'number'
  )
    return null;
  if (d.exp <= Math.floor(now.getTime() / 1000)) return null;
  return { state: d.state, verifier: d.verifier, next: d.next, exp: d.exp };
}

export interface WhopIdentity {
  whopUserId: string;
  email: string | null;
  name: string | null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Code → tokens → userinfo. Throws an Error with a short, secret-free message on failure. */
export async function completeAuthorization(opts: {
  apiOrigin: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  code: string;
  verifier: string;
  fetch?: Fetch;
}): Promise<WhopIdentity> {
  const f = opts.fetch ?? fetch;
  const tokenRes = await f(`${opts.apiOrigin}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.verifier,
      ...(opts.clientSecret ? { client_secret: opts.clientSecret } : {}),
    }),
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
  const tokens = parseJsonObject(await tokenRes.text());
  const access = tokens?.access_token;
  if (typeof access !== 'string' || !access) throw new Error('token response without access_token');
  const infoRes = await f(`${opts.apiOrigin}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
  });
  if (!infoRes.ok) throw new Error(`userinfo failed (${infoRes.status})`);
  const info = parseJsonObject(await infoRes.text());
  const sub = info?.sub;
  if (typeof sub !== 'string' || !/^user_[A-Za-z0-9]+$/.test(sub))
    throw new Error('userinfo without a Whop user id');
  const email =
    typeof info?.email === 'string' && info.email_verified !== false ? info.email : null;
  const name =
    typeof info?.name === 'string' && info.name.trim()
      ? info.name.trim().slice(0, 80)
      : typeof info?.preferred_username === 'string'
        ? info.preferred_username.slice(0, 80)
        : null;
  return { whopUserId: sub, email: email ? email.toLowerCase().slice(0, 254) : null, name };
}
