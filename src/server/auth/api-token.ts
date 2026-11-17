/**
 * Bearer-token sign-in for the admin API (scripts, the future MCP server):
 *
 *   Authorization: Bearer <ADMIN_API_TOKEN>
 *
 * Only /api/v1/admin/** accepts it (never the admin pages). The token is compared in constant
 * time (both sides hashed first, see secretsEqual). Token auth is off when ADMIN_API_TOKEN is
 * unset, and also when it is shorter than MIN_API_TOKEN_LENGTH (a weak token is treated as no
 * token). Generate one with `openssl rand -hex 32` and store it as a Wrangler secret. Requests
 * with a bearer token skip the same-origin (CSRF) check: browsers never attach it on their own.
 */
import { secretsEqual } from './crypto.ts';

export const MIN_API_TOKEN_LENGTH = 32;
/** Written to the audit log for token-authenticated changes. */
export const API_TOKEN_ACTOR = 'api-token';

/** The configured token, or null when token auth is off (unset or too short). */
export function apiTokenFrom(env: { ADMIN_API_TOKEN?: string | undefined }): string | null {
  const token = typeof env.ADMIN_API_TOKEN === 'string' ? env.ADMIN_API_TOKEN.trim() : '';
  return token.length >= MIN_API_TOKEN_LENGTH ? token : null;
}

/**
 * Reads the Authorization header: undefined when there is none, null when it is not a usable
 * Bearer credential, otherwise the token.
 */
export function bearerToken(request: Request): string | null | undefined {
  const header = request.headers.get('authorization');
  if (header === null) return undefined;
  const m = /^Bearer[ ]+([\x21-\x7e]{1,512})[ ]*$/i.exec(header);
  return m?.[1] ?? null;
}

export async function verifyApiToken(given: string, expected: string | null): Promise<boolean> {
  if (!expected) return false;
  return secretsEqual(given, expected);
}
