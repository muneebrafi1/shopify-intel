/**
 * Whop settings, read from environment variables (names in .dev.vars.example). Nothing is
 * required: without them sign-in shows "not open yet", checkout buttons say so, and the webhook
 * endpoint answers 503. Values are never logged.
 */

export interface WhopEnv {
  WHOP_CLIENT_ID?: string;
  WHOP_CLIENT_SECRET?: string;
  WHOP_WEBHOOK_SECRET?: string;
  WHOP_PRO_PRODUCT_ID?: string;
  WHOP_TEAM_PRODUCT_ID?: string;
  WHOP_CHECKOUT_PRO_MONTHLY?: string;
  WHOP_CHECKOUT_PRO_YEARLY?: string;
  WHOP_CHECKOUT_TEAM_MONTHLY?: string;
  WHOP_CHECKOUT_TEAM_YEARLY?: string;
  /** 'sandbox' uses sandbox-api.whop.com (no real money). Default: production. */
  WHOP_ENVIRONMENT?: string;
  /** Signs the short-lived OAuth state cookie. 32+ characters. */
  USER_SESSION_SECRET?: string;
  /** '1' enables /auth/dev (local development only; refused on non-local hosts). */
  DEV_SIGN_IN?: string;
}

export type CheckoutKey = 'pro-monthly' | 'pro-yearly' | 'team-monthly' | 'team-yearly';

export interface WhopConfig {
  /** OAuth endpoints base: https://api.whop.com or https://sandbox-api.whop.com */
  apiOrigin: string;
  oauth: { clientId: string; clientSecret: string | null } | null;
  stateSecret: string | null;
  webhookSecret: string | null;
  products: { pro: string | null; team: string | null };
  checkout: Record<CheckoutKey, string | null>;
  devSignIn: boolean;
}

const clean = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};
const httpsUrl = (v: string | undefined) => {
  const t = clean(v);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

export function readWhopConfig(env: WhopEnv): WhopConfig {
  const clientId = clean(env.WHOP_CLIENT_ID);
  const stateSecret = clean(env.USER_SESSION_SECRET);
  return {
    apiOrigin:
      env.WHOP_ENVIRONMENT?.trim() === 'sandbox'
        ? 'https://sandbox-api.whop.com'
        : 'https://api.whop.com',
    oauth:
      clientId && stateSecret && stateSecret.length >= 32
        ? { clientId, clientSecret: clean(env.WHOP_CLIENT_SECRET) }
        : null,
    stateSecret: stateSecret && stateSecret.length >= 32 ? stateSecret : null,
    webhookSecret: clean(env.WHOP_WEBHOOK_SECRET),
    products: { pro: clean(env.WHOP_PRO_PRODUCT_ID), team: clean(env.WHOP_TEAM_PRODUCT_ID) },
    checkout: {
      'pro-monthly': httpsUrl(env.WHOP_CHECKOUT_PRO_MONTHLY),
      'pro-yearly': httpsUrl(env.WHOP_CHECKOUT_PRO_YEARLY),
      'team-monthly': httpsUrl(env.WHOP_CHECKOUT_TEAM_MONTHLY),
      'team-yearly': httpsUrl(env.WHOP_CHECKOUT_TEAM_YEARLY),
    },
    devSignIn: env.DEV_SIGN_IN?.trim() === '1' && !!stateSecret,
  };
}

/** Dev sign-in only ever works on a local host, whatever the variable says. */
export const isLocalHost = (url: URL) =>
  url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
