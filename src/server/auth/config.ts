/**
 * Which sign-in methods protect the admin, decided from environment variables only.
 *
 *   CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD  → Cloudflare Access: the primary sign-in in
 *                                            production (the Access JWT is verified here too).
 *   ADMIN_PASSWORD + ADMIN_SESSION_SECRET  → password form + signed cookie. Locally the only
 *                                            method; in production the break-glass backup
 *                                            (owner decision): it keeps working when Access is
 *                                            configured, sits behind the Access application at
 *                                            the edge, and is what still works if Access has to be
 *                                            switched off in an emergency. Remove the two secrets
 *                                            to disable it.
 *   neither (or a half-configured pair)    → locked. The admin is never open by default.
 *
 * `mode` says what the sign-in page offers: 'password' shows the form (with `access` set when
 * Access is configured as well, and checked first), 'access' is Access only.
 * The admin API also accepts `Authorization: Bearer <ADMIN_API_TOKEN>` (src/server/auth/api-token.ts).
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
  /** Bearer token for scripts and the MCP server calling /api/v1/admin. Unset = disabled. */
  ADMIN_API_TOKEN?: string;
  /** Recipient of admin notifications (src/server/notify.ts). */
  ADMIN_NOTIFY_EMAIL?: string;
  /** Shared with the public API: salt for hashing client IPs. */
  IP_HASH_SALT?: string;
}

export interface AccessSettings {
  teamDomain: string;
  aud: string;
}

export type AuthConfig =
  | { mode: 'access'; teamDomain: string; aud: string }
  | { mode: 'password'; password: string; secret: string; access?: AccessSettings | null }
  | { mode: 'locked'; reason: string };

/** The Access settings in effect, if any (Access only, or Access + break-glass password). */
export const accessSettings = (config: AuthConfig): AccessSettings | null =>
  config.mode === 'access'
    ? { teamDomain: config.teamDomain, aud: config.aud }
    : config.mode === 'password'
      ? (config.access ?? null)
      : null;

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
        reason:
          'Cloudflare Access is half configured: set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.',
      };
    }
    const teamDomain = normalizeTeamDomain(team);
    if (!teamDomain) {
      return {
        mode: 'locked',
        reason: 'CF_ACCESS_TEAM_DOMAIN is not a valid <team>.cloudflareaccess.com domain.',
      };
    }
    // Break-glass: a valid password pair stays usable next to Access. A missing or weak pair
    // only disables the backup; it never locks Access out.
    const backup = readPassword(env);
    return backup.ok
      ? { mode: 'password', ...backup.value, access: { teamDomain, aud } }
      : { mode: 'access', teamDomain, aud };
  }

  const pw = readPassword(env);
  return pw.ok ? { mode: 'password', ...pw.value } : { mode: 'locked', reason: pw.reason };
}

function readPassword(
  env: Partial<AdminEnv>,
): { ok: true; value: { password: string; secret: string } } | { ok: false; reason: string } {
  // Passwords are compared exactly as entered (no trimming), but must not be blank.
  const password = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD : '';
  const secret = clean(env.ADMIN_SESSION_SECRET);
  if (!password.trim() && !secret) {
    return {
      ok: false,
      reason:
        'No sign-in method is configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (production) or ADMIN_PASSWORD and ADMIN_SESSION_SECRET (local).',
    };
  }
  if (!password.trim() || !secret) {
    return {
      ok: false,
      reason: 'Password sign-in needs both ADMIN_PASSWORD and ADMIN_SESSION_SECRET.',
    };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      reason: `ADMIN_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters of random data.`,
    };
  }
  return { ok: true, value: { password, secret } };
}
