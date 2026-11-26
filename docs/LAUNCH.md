# Launch Runbook

Nothing in this repo has been deployed or provisioned yet. Follow these steps **only after**
merging the PR stack to `main` and confirming the owner approvals in `docs/HANDOFF.md`.

## 1. Pre-launch config & brand (skip for a temporary `workers.dev` preview)

1. Pick the final brand name and domain (must not include "Shopify").
2. Edit `src/config/site.ts`:
   - `SITE_NAME` (replaces the placeholder `Vitrine` across UI, OG PNG, and metadata)
   - `SITE_DOMAIN` (replaces `vitrine.example` for canonicals, sitemaps, and contact addresses)
   - `SHOW_CAPTURE_PREVIEW_NOTICE` → set to `false` **only after** real store captures are
     uploaded to R2 and ingested into D1
3. Regenerate the static OG fallback image so it carries the final brand name and tagline:

   ```bash
   node scripts/build-og.mjs
   ```

4. Check `.github/workflows/ci.yml` and `npm run lint` + `npm run check` + `npm test`.

## 2. Create Cloudflare D1 & R2 resources

```bash
npx wrangler login
npx wrangler d1 create shopify-intel
npx wrangler r2 bucket create shopify-intel-media
```

Copy the UUID printed by `wrangler d1 create` into `wrangler.jsonc` (`d1_databases[0].database_id`,
replacing `00000000-0000-0000-0000-000000000000`).

Run the offline launch check to verify config and migrations:

```bash
npm run ops:preflight -- --strict   # passes once database_id, SITE_DOMAIN, and notice are updated
```

## 3. Apply D1 migrations & seed data

```bash
npx wrangler d1 migrations apply DB --remote
npm run db:build-seed
npx wrangler d1 execute DB --remote --file=.data/seed.sql
```

Confirm the row counts:

```bash
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS curated FROM stores WHERE is_curated = 1;"
```

## 4. Set Worker secrets

Never commit secrets to git and never set `DEV_SIGN_IN` in production. Generate random secrets
with `openssl rand -hex 32` and push each via Wrangler:

```bash
# Required for public API rate-limiting + admin break-glass + user sessions
npx wrangler secret put IP_HASH_SALT
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put USER_SESSION_SECRET

# Cloudflare Access (primary protection for /admin and /api/v1/admin)
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN    # e.g. <team>.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD            # Access application AUD tag

# Optional break-glass admin password + machine API token
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_API_TOKEN          # 32+ random chars for scripts/ingest

# Optional admin removal-request notification target
npx wrangler secret put ADMIN_NOTIFY_EMAIL
```

### Whop accounts & Pro/Team (see `docs/ACCOUNTS.md`)

Start in Whop Sandbox (`WHOP_ENVIRONMENT=sandbox`), verify one end-to-end sign-in + checkout +
webhook delivery, then switch to production credentials:

```bash
npx wrangler secret put WHOP_CLIENT_ID
npx wrangler secret put WHOP_CLIENT_SECRET       # optional with PKCE, recommended for confidential client
npx wrangler secret put WHOP_WEBHOOK_SECRET      # ws_... for https://<origin>/api/whop/webhook
npx wrangler secret put WHOP_PRO_PRODUCT_ID      # prod_...
npx wrangler secret put WHOP_TEAM_PRODUCT_ID     # prod_...
npx wrangler secret put WHOP_CHECKOUT_PRO_MONTHLY
npx wrangler secret put WHOP_CHECKOUT_PRO_YEARLY
npx wrangler secret put WHOP_CHECKOUT_TEAM_MONTHLY
npx wrangler secret put WHOP_CHECKOUT_TEAM_YEARLY
# Optional while testing in sandbox only:
# npx wrangler secret put WHOP_ENVIRONMENT
```

## 5. Protect `/admin` with Cloudflare Access

In Cloudflare Zero Trust → Access → Applications, add a Self-hosted application covering:

- `<your-domain>/admin*`
- `<your-domain>/api/v1/admin*`

For automated scripts (`crawl:ingest`, `capture:ingest`, maintenance purge), create an Access
Service Token and send `CF-Access-Client-Id` + `CF-Access-Client-Secret` alongside
`Authorization: Bearer <ADMIN_API_TOKEN>`.

## 6. Build & deploy the Worker

For a `workers.dev` preview (before setting a custom domain), pass `PUBLIC_SITE_URL` so canonicals,
`robots.txt`, and sitemaps match the preview origin:

```bash
PUBLIC_SITE_URL="https://shopify-intel.<your-subdomain>.workers.dev" npm run build
npx wrangler deploy
```

A preview that must stay out of Google is built with `PUBLIC_NOINDEX=1` as well: `robots.txt`
becomes `Disallow: /` and every response carries `X-Robots-Tag: noindex, nofollow`. Leave the
variable out of the production build.

For custom-domain production (after updating `SITE_DOMAIN` in `src/config/site.ts` and attaching
the custom domain / route in Cloudflare Workers):

```bash
npm run build
npx wrangler deploy
```

## 7. Post-deploy smoke checks & Search Console

Run the read-only HTTP smoke suite against the deployed origin:

```bash
npm run ops:smoke -- https://<your-deployed-origin>
```

It verifies `/`, `/robots.txt`, `/sitemap.xml`, `/sitemaps/core.xml`, `/sitemaps/sections.xml`,
`/og-default.png`, `/api/v1/meta`, `POST /mcp` (`tools/list` = 22 tools), `/pro` (`FAQPage`
JSON-LD), `/teardowns`, and that `/admin` + `/account` redirect closed (`302`, `no-store`,
`noindex`).

Then:

1. Submit `https://<your-domain>/sitemap.xml` in Google Search Console.
2. Optionally upload verified `.data/captures/` assets to the R2 `MEDIA` bucket, set
   `SHOW_CAPTURE_PREVIEW_NOTICE = false` in `src/config/site.ts`, and redeploy.
3. Optionally enable the daily retention purge (`POST /api/v1/admin/maintenance/purge-removal-records`
   or uncomment `triggers.crons` in `wrangler.jsonc` once a `scheduled()` handler is wired).
