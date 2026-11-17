/**
 * Cloudflare Access JWT verification (production sign-in).
 *
 * When the admin is behind an Access application, every request carries a signed JWT in the
 * `Cf-Access-Jwt-Assertion` header (and the `CF_Authorization` cookie). We never trust it
 * blindly: the signature is checked with WebCrypto against the team's public keys
 * (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), and `aud`, `iss`, `exp` and
 * `nbf` are checked. Only RS256 is accepted. Keys are cached in memory per isolate.
 *
 * Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
import { base64UrlDecode, fromUtf8, parseJsonObject, utf8 } from './crypto.ts';

export interface AccessIdentity {
  /** Email of the signed-in person, or the service token's common name. */
  actor: string;
  /** Expiry of the Access token (unix seconds). */
  exp: number;
}

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
}

export type FetchCerts = (url: string) => Promise<{ keys?: Jwk[] } | null>;

export interface AccessVerifierOptions {
  /** `myteam`, `myteam.cloudflareaccess.com` or `https://myteam.cloudflareaccess.com`. */
  teamDomain: string;
  /** The Access application's Audience (AUD) tag. */
  aud: string;
  /** Override for tests. Defaults to `fetch` with a short timeout. */
  fetchCerts?: FetchCerts;
  /** Override for tests. */
  now?: () => Date;
  /** Override for tests (isolated cache). Defaults to the module-wide cache. */
  cache?: KeyCache;
}

/** Cached public keys per certs URL. */
export type KeyCache = Map<string, { fetchedAt: number; keys: Map<string, CryptoKey> }>;

const moduleCache: KeyCache = new Map();
/** Keys are refreshed after this long, and at most this often when an unknown `kid` shows up. */
const KEY_TTL_MS = 60 * 60 * 1000;
const MIN_REFETCH_MS = 30 * 1000;
const CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LENGTH = 16 * 1024;

/** Returns the bare team host (`myteam.cloudflareaccess.com`) or null if it is not valid. */
export function normalizeTeamDomain(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) host = `${host}.cloudflareaccess.com`;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(host) ? host : null;
}

const defaultFetchCerts: FetchCerts = async (url) => {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  return (await res.json()) as { keys?: Jwk[] };
};

async function importKeys(jwks: { keys?: Jwk[] } | null): Promise<Map<string, CryptoKey>> {
  const out = new Map<string, CryptoKey>();
  for (const jwk of jwks?.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
    if (jwk.alg && jwk.alg !== 'RS256') continue;
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      out.set(jwk.kid, key);
    } catch {
      // Skip malformed keys; the others may still verify.
    }
  }
  return out;
}

export function createAccessVerifier(options: AccessVerifierOptions) {
  const team = normalizeTeamDomain(options.teamDomain);
  const aud = options.aud.trim();
  const fetchCerts = options.fetchCerts ?? defaultFetchCerts;
  const now = options.now ?? (() => new Date());
  const cache = options.cache ?? moduleCache;
  const certsUrl = team ? `https://${team}/cdn-cgi/access/certs` : '';
  const issuer = team ? `https://${team}` : '';

  async function keyFor(kid: string): Promise<CryptoKey | null> {
    const t = now().getTime();
    const entry = cache.get(certsUrl);
    const fresh = entry && t - entry.fetchedAt < KEY_TTL_MS;
    const known = entry?.keys.get(kid);
    if (known && fresh) return known;
    // Unknown kid (key rotation) or stale cache: refetch, but not more than every 30 s.
    if (entry && t - entry.fetchedAt < MIN_REFETCH_MS) return known ?? null;
    try {
      const keys = await importKeys(await fetchCerts(certsUrl));
      if (keys.size > 0) cache.set(certsUrl, { fetchedAt: t, keys });
      else if (entry) entry.fetchedAt = t;
      return keys.get(kid) ?? null;
    } catch {
      // Network trouble: keep using a key we already trust, otherwise deny.
      return known ?? null;
    }
  }

  /** Returns the identity for a valid token, or null. Never throws on bad input. */
  async function verify(token: string | null | undefined): Promise<AccessIdentity | null> {
    if (!team || !aud || !token || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];

    const headerBytes = base64UrlDecode(h);
    const payloadBytes = base64UrlDecode(p);
    const signature = base64UrlDecode(s);
    if (!headerBytes || !payloadBytes || !signature) return null;
    const header = parseJsonObject(fromUtf8(headerBytes));
    const claims = parseJsonObject(fromUtf8(payloadBytes));
    if (!header || !claims) return null;
    // Pin the algorithm: never 'none', never HS256 with a public key as the secret.
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    const key = await keyFor(header.kid);
    if (!key) return null;
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      utf8(`${h}.${p}`),
    );
    if (!valid) return null;

    const t = Math.floor(now().getTime() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(aud)) return null;
    if (claims.iss !== issuer) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= t) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > t + CLOCK_SKEW_SECONDS) return null;
    if (typeof claims.iat === 'number' && claims.iat > t + CLOCK_SKEW_SECONDS) return null;

    const actor =
      (typeof claims.email === 'string' && claims.email) ||
      (typeof claims.common_name === 'string' && claims.common_name) ||
      (typeof claims.sub === 'string' && claims.sub) ||
      'access';
    return { actor, exp: claims.exp };
  }

  return { verify, issuer, certsUrl };
}
