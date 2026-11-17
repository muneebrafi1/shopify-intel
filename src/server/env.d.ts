// Bindings and variables this app reads from the Worker env (`import { env } from 'cloudflare:workers'`).
// Names are documented in .env.example / .dev.vars.example. Optional strings are secrets or vars
// that may be unset locally.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    IP_HASH_SALT?: string;
    MEDIA_BASE_URL?: string;
  }
}
