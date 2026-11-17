/**
 * Signed admin session tokens for the password sign-in (local/dev, or when Cloudflare Access is
 * not configured).
 *
 * Format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`. The payload carries only
 * timestamps and a random id; nothing secret. The signing key is derived from
 * ADMIN_SESSION_SECRET *and* ADMIN_PASSWORD, so rotating either one signs everybody out.
 */
import { base64UrlDecode, base64UrlEncode, fromUtf8, hmacKey, hmacSign, parseJsonObject, utf8 } from './crypto.ts';

/** Sessions last 12 hours. There is no sliding renewal: sign in again after that. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** Tolerated clock difference between isolates, in seconds. */
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 512;
const VERSION = 'v1';

export interface SessionSecrets {
  secret: string;
  password: string;
}

export interface SessionPayload {
  /** Issued at (unix seconds). */
  iat: number;
  /** Expires at (unix seconds). */
  exp: number;
  /** Random id, so two sessions issued in the same second differ (and can be told apart in logs). */
  jti: string;
}

let cachedKey: { secret: string; password: string; key: Promise<CryptoKey> } | null = null;

async function signingKey({ secret, password }: SessionSecrets): Promise<CryptoKey> {
  if (cachedKey && cachedKey.secret === secret && cachedKey.password === password) {
    return cachedKey.key;
  }
  const key = (async () => {
    const root = await hmacKey(secret);
    const derived = await hmacSign(root, `admin-session-key:${VERSION}:${password}`);
    return hmacKey(derived);
  })();
  cachedKey = { secret, password, key };
  return key;
}

const nowSeconds = (now: Date) => Math.floor(now.getTime() / 1000);

export async function signSession(
  secrets: SessionSecrets,
  now: Date = new Date(),
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<{ token: string; payload: SessionPayload }> {
  const iat = nowSeconds(now);
  const payload: SessionPayload = {
    iat,
    exp: iat + ttlSeconds,
    jti: base64UrlEncode(crypto.getRandomValues(new Uint8Array(12))),
  };
  const body = `${VERSION}.${base64UrlEncode(utf8(JSON.stringify(payload)))}`;
  const sig = await hmacSign(await signingKey(secrets), body);
  return { token: `${body}.${base64UrlEncode(sig)}`, payload };
}

/** Returns the payload of a valid, unexpired token, or null. Never throws on bad input. */
export async function verifySession(
  token: string | null | undefined,
  secrets: SessionSecrets,
  now: Date = new Date(),
): Promise<SessionPayload | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [version, body, sigText] = parts as [string, string, string];
  const sig = base64UrlDecode(sigText);
  if (!sig || sig.length !== 32) return null;

  // crypto.subtle.verify compares the MAC in constant time.
  const key = await signingKey(secrets);
  const valid = await crypto.subtle.verify('HMAC', key, sig, utf8(`${version}.${body}`));
  if (!valid) return null;

  const raw = base64UrlDecode(body);
  const data = raw ? parseJsonObject(fromUtf8(raw)) : null;
  if (!data) return null;
  const { iat, exp, jti } = data;
  if (typeof iat !== 'number' || typeof exp !== 'number' || typeof jti !== 'string') return null;

  const t = nowSeconds(now);
  if (exp <= t) return null;
  if (iat > t + CLOCK_SKEW_SECONDS) return null;
  if (exp - iat > SESSION_TTL_SECONDS) return null;
  return { iat, exp, jti };
}
