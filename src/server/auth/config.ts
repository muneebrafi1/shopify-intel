/**
 * Which sign-in method protects the admin, decided from environment variables only.
 *
 *   CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD  → Cloudflare Access (production). Password sign-in is
 *                                            then disabled, so Access cannot be bypassed.
 *   ADMIN_PASSWORD + ADMIN_SESSION_SECRET  → password form + signed cookie (local / dev).
 *   neither (or a half-configured pair)    → locked. The admin is never open by default.
 *
 * Names are documented in .env.example and .dev.vars.example (names only, never values).
 */
import { normalizeTeamDomain } from './access.ts';

/** Bindings and variables the admin reads (Wrangler vars/secrets, or .dev.vars locally). */
export interface AdminEnv {
  DB: D1Database;
  MEDIA?: R2Bucket;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /** Shared with the public API: salt for hashing client IPs. */
  IP_HASH_SALT?: string;
}

export type AuthConfig =
  | { mode: 'access'; teamDomain: string; aud: string }
  | { mode: 'password'; password: string; secret: string }
  | { mode: 'locked'; reason: string };

export const MIN_PASSWORD_LENGTH = 8;
export const MIN_SECRET_LENGTH = 32;

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function readAuthConfig(env: Partial<AdminEnv>): AuthConfig {
  const team = clean(env.CF_ACCESS_TEAM_DOMAIN);
  const aud = clean(env.CF_ACCESS_AUD);
  if (team || aud) {
    if (!team || !aud) {
      return {
        mode: 'locked',
        reason: 'Cloudflare Access is half configured: set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.',
      };
    }
    const teamDomain = normalizeTeamDomain(team);
    if (!teamDomain) {
      return {
        mode: 'locked',
        reason: 'CF_ACCESS_TEAM_DOMAIN is not a valid <team>.cloudflareaccess.com domain.',
      };
    }
    return { mode: 'access', teamDomain, aud };
  }

  // Passwords are compared exactly as entered (no trimming), but must not be blank.
  const password = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD : '';
  const secret = clean(env.ADMIN_SESSION_SECRET);
  if (!password.trim() && !secret) {
    return {
      mode: 'locked',
      reason:
        'No sign-in method is configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (production) or ADMIN_PASSWORD and ADMIN_SESSION_SECRET (local).',
    };
  }
  if (!password.trim() || !secret) {
    return {
      mode: 'locked',
      reason: 'Password sign-in needs both ADMIN_PASSWORD and ADMIN_SESSION_SECRET.',
    };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      mode: 'locked',
      reason: `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      mode: 'locked',
      reason: `ADMIN_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters of random data.`,
    };
  }
  return { mode: 'password', password, secret };
}
