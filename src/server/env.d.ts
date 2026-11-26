// Bindings and variables this app reads from the Worker env (`import { env } from 'cloudflare:workers'`).
// Names are documented in .env.example / .dev.vars.example. Optional strings are secrets or vars
// that may be unset locally.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    IP_HASH_SALT?: string;
    MEDIA_BASE_URL?: string;
    /** Recipient of admin notifications (new removal requests). */
    ADMIN_NOTIFY_EMAIL?: string;
    /** Bearer token for scripts calling /api/v1/admin (32+ chars). Unset = token auth off. */
    ADMIN_API_TOKEN?: string;
    ADMIN_PASSWORD?: string;
    ADMIN_SESSION_SECRET?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    /** Accounts + Pro via Whop (docs/ACCOUNTS.md). */
    USER_SESSION_SECRET?: string;
    DEV_SIGN_IN?: string;
    WHOP_CLIENT_ID?: string;
    WHOP_CLIENT_SECRET?: string;
    WHOP_ENVIRONMENT?: string;
    WHOP_WEBHOOK_SECRET?: string;
    WHOP_PRO_PRODUCT_ID?: string;
    WHOP_TEAM_PRODUCT_ID?: string;
    WHOP_CHECKOUT_PRO_MONTHLY?: string;
    WHOP_CHECKOUT_PRO_YEARLY?: string;
    WHOP_CHECKOUT_TEAM_MONTHLY?: string;
    WHOP_CHECKOUT_TEAM_YEARLY?: string;
  }
}
