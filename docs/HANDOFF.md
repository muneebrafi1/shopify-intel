# Handoff

_Last updated: 26 Nov 2026, M7 Launch prep (PR #19). Update this file before stopping for any
reason._

## Status

**All build milestones (M1–M7) are feature-complete.** Nothing is merged to `main` after #11,
nothing is deployed, no cloud resources exist, and no money has been spent.

- **Launch prep (M7):** in **PR #19** (`feat/19-launch-prep`, stacked on #18).
  - Baseline security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`,
    `X-Frame-Options: SAMEORIGIN`) on public SSR responses and static assets (`public/_headers`),
    while `/admin` keeps `DENY` / `same-origin` / `no-store`.
  - Complete `Cloudflare.Env` typing in `src/server/env.d.ts` and `.env.example` parity with
    `.dev.vars.example`.
  - Launch preflight & read-only HTTP smoke script (`scripts/ops/preflight.ts`, `npm run
ops:preflight`, `npm run ops:smoke`) + CI check + unit tests.
  - Step-by-step `docs/LAUNCH.md` runbook, ordered PR merge list, owner approval checklist, and
    exact post-merge deploy commands in this file.
- **SEO & content (M6):** in **PR #18** (`feat/18-seo-content`, stacked on #17).
  - XML sitemaps (`/sitemap.xml`, `/sitemaps/core.xml`, `/sitemaps/sections.xml`), static PNG OG
    fallback (`public/og-default.png`, `scripts/build-og.mjs`) + capture OG/Twitter meta, Pro &
    legal JSON-LD (`FAQPage`, `SoftwareApplication`/`Offer`, `WebPage`, `BreadcrumbList`),
    explicit canonicals, and 3 new factual teardowns (LSKD, Thursday Boot Co., Negative Underwear).
- **MCP server (M5):** in **PR #17** (`feat/17-mcp-server`, stacked on #16).
  - Read-only MCP server (`POST /mcp`) exposing 22 tools over API v1 with D1 per-IP rate limiting
    (`migrations/0005_mcp_rate_limit.sql`, 60 req/min/IP) and setup guide on `/developers#mcp`.
- **Accounts & Pro via Whop (M4):** in **PR #16** (`feat/16-accounts-pro`, stacked on #15).
  - Whop OAuth + PKCE sign-in, signed user sessions (`migrations/0004_accounts.sql`), signed
    Whop webhooks (`POST /api/whop/webhook`), Pro/Team saved boards (save, rename, delete, CSV
    export), Pro checkout links, and localhost-only `/auth/dev`.
- **Data depth (M3):** in **PR #15** (`feat/15-data-depth`, stacked on #14).
  - 50 curated stores (20 exported + 30 picked from the 930-store scan, one or two per theme);
  - local storefront crawler on StorePeek's rules (`npm run crawl`) and scan ingest endpoint
    (`POST /api/v1/admin/scans`, `npm run crawl:ingest`, local base only);
  - Theme Store facts per theme (`migrations/0003_theme_store_facts.sql`, `npm run crawl:themes`),
    with source links and dates;
  - section detection by content and header/footer group (unknown sections reduced from ~15% to
    ~4.5%). See `docs/CRAWL.md`.
- **Capture depth (M2):** in **PR #14** (`feat/14-capture-depth`, stacked on #13).
  - Collection, product, and cart pages discovered from home; product gallery/buy box split;
    stitched viewport capture for lazy-drawn themes; pre-cut `.top.webp` grid thumbnails;
    data-independent e2e; missing teardown notes state their status cleanly.
- **Local capture pipeline (M1):** in **PR #13** (`feat/13-capture-pipeline`, stacked on #12).
  - Local Playwright capture pipeline (`npm run capture`, `npm run capture:ingest`) writing WebP
    captures to `.data/captures/` (gitignored) and local R2 + D1. See `docs/CAPTURE.md`.
- **SaaS redesign + owner decisions:** in **PR #12** (`feat/12-saas-redesign`, stacked on #11).
  - Product-grade SaaS UI (light default, dark toggle, vermilion accent), applied owner drafts,
    protected admin API (`/api/v1/admin/*`), and D1 query budget (`≤ 38` statements/request, hard
    cap 45 vs D1 free limit 50).
- **Base build:** complete in PRs `#1`–`#11` (`main` currently sits at `#11`).

## Phase 2 decisions (owner approved phase 2; small calls made by the agent)

- **Cart captures dropped.** Filling a cart needs `POST /cart/add.js`, which Shopify's robots.txt
  disallows. Page types are home, collection and product; cart-only section types show no crops.
- **Identifying crawler.** Every request carries `VitrineBot/1.0 (+<site>/methodology#crawler)`
  (appended to a real browser UA for captures, so layouts render normally). robots.txt is read
  for our token, then `*`; a network error retries once, then counts as "disallowed". Opt-out
  instructions are on /methodology#crawler. The UA did not break captures (0 failures so far).
- **Stable ids + row-diff syncs.** `data/curation/ids.json` keeps store/app/theme/app-category ids
  forever; the remote D1 is never re-seeded, only diffed with `scripts/ops/d1-sync.ts` (the D1
  free plan's 100k rows written/day is account-wide and shared with other products). Stores that
  are opted out, tombstoned, blocked or hidden remotely are never touched by a sync.
- **Capture preview notice off** once real captures are live.
- **More stores.** Curated stores grow in niche-balanced batches (`scripts/curation/suggest_stores.py`):
  English storefronts with a detected theme and ≥3 apps, category from the store's own name,
  title and description (keyword rules, margin ≥2), at most ~30 per category. Names/categories are
  editorial suggestions in `data/curation/stores.json`; country only from an unambiguous ccTLD.
- **More apps.** `npm run seed:import-apps` adds every signature app that was really detected on a
  scanned store and has a cached App Store listing (no undetected or listing-less apps): +350 apps,
  449 total. Trustpilot stays unmatched (override).
- **Weekly crawler.** Cron Trigger every 10 minutes scans one store (round-robin, ≈ every store
  weekly) from the HTML only, with precise signals (99% precision vs the browser crawler on a 35-store
  check, ~1.5 ms CPU). It records theme switches/version bumps and newly seen apps; it never closes
  apps and never rebuilds derived tables remotely (a full rebuild rewrites ~60k rows). Once it runs,
  scan/history tables are remote-owned: d1-sync must not overwrite them.
- **Second store batch (297 curated).** Same rules with ≥2 apps and ≤40 per category, after the
  26 Nov browser crawl added each store's title/description/language. Left out: the operator's own
  store (xovist.com) and thin pages. About 30 names/categories were corrected by hand.
- **26 Nov crawl is the history baseline.** It re-scanned 929 stores with newer signatures, so the
  apps it adds over the 17 Nov scan are mostly detection gains, not installs. "Newly seen" alerts
  or trend pages should only count changes from the weekly crawler onwards. A seed row that never
  named a theme is filled in place, not recorded as a theme switch.
- **Teardowns follow the captures.** Notes point at sections that were really captured; where an
  app's placement isn't in the page code, the note says so instead of guessing.

## Ordered PR merge list

Merge **bottom-up** in exact stack order so each PR lands cleanly on `main`. Do **not** merge the
`pr-screenshots` branch (images only).

| Order | PR                                                            | Branch                     | Summary                                                                                  |
| ----- | ------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| 1–11  | `#1`–`#11`                                                    | `feat/01`–`feat/11`        | Base build (already merged to `main`)                                                    |
| 12    | [`#12`](https://github.com/muneebrafi1/shopify-intel/pull/12) | `feat/12-saas-redesign`    | SaaS redesign (light/dark), owner drafts, admin API, `0002_capture_block.sql`, D1 budget |
| 13    | [`#13`](https://github.com/muneebrafi1/shopify-intel/pull/13) | `feat/13-capture-pipeline` | Local capture pipeline (`npm run capture`, `capture:ingest`), `ingestCapture()`          |
| 14    | [`#14`](https://github.com/muneebrafi1/shopify-intel/pull/14) | `feat/14-capture-depth`    | Collection/product/cart captures, stitched mode, `.top.webp` thumbnails                  |
| 15    | [`#15`](https://github.com/muneebrafi1/shopify-intel/pull/15) | `feat/15-data-depth`       | 50 curated stores, crawler + Theme Store facts (`0003_theme_store_facts.sql`)            |
| 16    | [`#16`](https://github.com/muneebrafi1/shopify-intel/pull/16) | `feat/16-accounts-pro`     | Whop OAuth + PKCE, saved boards + CSV export, webhooks (`0004_accounts.sql`)             |
| 17    | [`#17`](https://github.com/muneebrafi1/shopify-intel/pull/17) | `feat/17-mcp-server`       | Read-only MCP server (`POST /mcp`, 22 tools) + rate limit (`0005_mcp_rate_limit.sql`)    |
| 18    | [`#18`](https://github.com/muneebrafi1/shopify-intel/pull/18) | `feat/18-seo-content`      | XML sitemaps, PNG OG fallback + meta, Pro/legal JSON-LD, 3 new teardowns                 |
| 19    | `#19`                                                         | `feat/19-launch-prep`      | Security headers, `env.d.ts` parity, `ops:preflight` / `ops:smoke`, `docs/LAUNCH.md`     |

## Owner approval & decision checklist (waiting only on Muneeb)

1. **Merge the PR stack (`#12` → `#19`)** on GitHub (or approve merging them in order).
2. **`workers.dev` preview deploy:** yes/no to create a free Cloudflare D1 database + deploy a
   preview Worker URL before custom-domain launch.
3. **R2 storage & public real captures:** yes/no to create the R2 `shopify-intel-media` bucket,
   ingest real store screenshots into production R2, and set `SHOW_CAPTURE_PREVIEW_NOTICE = false`.
4. **Final brand name & domain:** replace placeholder `SITE_NAME = 'Vitrine'` and `SITE_DOMAIN =
'vitrine.example'` in `src/config/site.ts` (must not contain "Shopify"), then rerun
   `node scripts/build-og.mjs`.
5. **Whop account & live keys:** create the Whop app, Pro (`$12/mo`, `$120/yr`) and Team (`$39/mo`,
   `$390/yr`) products, checkout links, and webhook endpoint (verify sandbox first). Also confirm:
   - Whop-only sign-in (no email magic link until a mail provider is added)?
   - Gate non-home capture page types for Free users now, or after captures go live?
   - Team seat invites: Whop seats or in-app invites?
6. **`cart` captures & crawler identity (`robots.txt`):**
   - Keep `POST /cart/add.js` before cart screenshots, or drop cart captures to stay strictly
     outside Shopify's `/cart/` disallow rule?
   - Keep desktop Chrome UA or switch crawler/capture UA to an identifying bot name (`VitrineBot`
     - contact URL)?
7. **Editorial data spot-check:** review store names/categories/countries in
   `data/curation/stores.json` and app short names in `data/curation/apps.json`.
8. **Legal & product details (remaining drafts):**
   - Legal entity address, refund policy, and legal review of `/privacy` and `/terms`.
   - Confirm Free vs Pro feature split, Team shared boards, theme-switch alerts, and $79 lifetime
     deal copy on `/pro`.
   - Confirm permanent capture blocks, admin purge button vs API-only, and 404 vs 200+noindex for
     non-curated compare pairs.

## Post-merge deploy commands

See `docs/LAUNCH.md` for full explanations, Cloudflare Access setup, and Whop sandbox steps.

### Option A — Free `workers.dev` preview deploy (after Muneeb approves D1 + preview)

```bash
git checkout main && git pull
npm ci
npx wrangler login
npx wrangler d1 create shopify-intel
# Put the returned database_id into wrangler.jsonc (d1_databases[0].database_id)

npx wrangler d1 migrations apply DB --remote
npm run db:build-seed
npx wrangler d1 execute DB --remote --file=.data/seed.sql

# Set required Worker secrets (generate with: openssl rand -hex 32)
npx wrangler secret put IP_HASH_SALT
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put USER_SESSION_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_API_TOKEN

PUBLIC_SITE_URL="https://shopify-intel.<your-subdomain>.workers.dev" npm run build
npx wrangler deploy
npm run ops:smoke -- "https://shopify-intel.<your-subdomain>.workers.dev"
```

### Option B — Full production launch (custom domain + R2 + Access + Whop)

```bash
# 1. Update src/config/site.ts (SITE_NAME, SITE_DOMAIN, SHOW_CAPTURE_PREVIEW_NOTICE=false)
node scripts/build-og.mjs
npm run lint && npm run check && npm test

# 2. Provision D1 + R2 (if not already created in Option A)
npx wrangler d1 create shopify-intel
npx wrangler r2 bucket create shopify-intel-media
# Update database_id in wrangler.jsonc, then verify:
npm run ops:preflight -- --strict

# 3. Migrate & seed remote D1
npx wrangler d1 migrations apply DB --remote
npm run db:build-seed
npx wrangler d1 execute DB --remote --file=.data/seed.sql

# 4. Push secrets (never set DEV_SIGN_IN in production)
npx wrangler secret put IP_HASH_SALT
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put USER_SESSION_SECRET
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put ADMIN_NOTIFY_EMAIL
npx wrangler secret put WHOP_CLIENT_ID
npx wrangler secret put WHOP_CLIENT_SECRET
npx wrangler secret put WHOP_WEBHOOK_SECRET
npx wrangler secret put WHOP_PRO_PRODUCT_ID
npx wrangler secret put WHOP_TEAM_PRODUCT_ID
npx wrangler secret put WHOP_CHECKOUT_PRO_MONTHLY
npx wrangler secret put WHOP_CHECKOUT_PRO_YEARLY
npx wrangler secret put WHOP_CHECKOUT_TEAM_MONTHLY
npx wrangler secret put WHOP_CHECKOUT_TEAM_YEARLY

# 5. Build, deploy, and smoke-check
npm run build
npx wrangler deploy
npm run ops:smoke -- "https://<your-domain>"
```

## Owner decisions applied in #12 (drafts)

- **Design:** references Linear, Attio, Stripe, Vercel, Cloudflare, Dovetail, Base44, Twenty;
  light default, dark by system setting + toggle, vermilion kept (`#cf4519` on light Pro button for
  AA contrast); see `docs/design/direction.md`.
- **Legal:** entity `Xovist` (`LEGAL_ENTITY`), governing law Pakistan, removal records retained 2
  years (`purgeExpiredRemovalRecords`), "within 3 business days" SLA, notifications logged for
  `ADMIN_NOTIFY_EMAIL`.
- **Pro** (`src/components/static/content.ts`): Free (home-page screenshots + basic data), Pro
  ($12/mo or $120/yr), Team (3 seats, $39/mo or $390/yr), yearly = 2 months free.
- **Admin:** Cloudflare Access primary + break-glass password backup; approving removal creates
  permanent `capture_blocks`; protected `/api/v1/admin/*` + protected OpenAPI doc.
- **Product:** equal usage shares a rank; `/compare` only renders curated pairs (others 404);
  teardown byline "Editorial team"; `/stores` curated by default (`?scope=all` for every detected
  store).
- **Data:** `trustpilot` unlinked from Trustgear; Hyper affiliate link removed (`overrides.json`).

## How to run locally

```bash
npm install
npm run setup        # builds .data/seed.sql and loads it into local D1 (.wrangler/state)
npm run dev          # http://localhost:4321 (Astro 7 SSR inside workerd, local D1 + R2)
```

- Checks:
  - `npm run lint` (project rules + Prettier)
  - `npm run check` (`astro check`)
  - `npm test` (Vitest)
  - `npm run build && npm run size`
  - `npm run ops:preflight` (offline config + migration + asset parity audit)
  - `npm run test:e2e` (Playwright at 390px and 1440px against `astro preview`)
  - `npm run budget:queries` (dev server up: fails if any route exceeds 45 D1 statements)
- Fresh store facts in dev: `npm run crawl -- --curated`, then (dev up) `npm run crawl:ingest`
  with a local throwaway `ADMIN_API_TOKEN` (32+ chars) in `.dev.vars`. See `docs/CRAWL.md`.
- Real captures in dev: `npm run capture` (Playwright → `.data/captures/`), then stop dev and
  `npm run capture:ingest` (local R2 + D1). Re-run `capture:ingest` after every `npm run setup`.
- Screenshots of any routes: `npm run screens -- --base http://127.0.0.1:4321 / /themes`.
  Add `--theme dark` for dark mode.

## Where things are

| Area                                         | Read first                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Launch runbook & smoke checks                | `docs/LAUNCH.md`, `scripts/ops/preflight.ts`                                                     |
| Visual direction (v2, SaaS, light + dark)    | `docs/design/direction.md`, then `docs/DESIGN.md`, `/design-system`                              |
| Architecture                                 | `docs/ARCHITECTURE.md`                                                                           |
| API (one definition → HTTP, in-process, MCP) | `docs/API.md`, `src/server/api/v1/`                                                              |
| MCP server (`/mcp`, 22 read-only tools)      | `docs/MCP.md`, `src/server/mcp/`                                                                 |
| Accounts + Pro (Whop)                        | `docs/ACCOUNTS.md`, `src/server/whop/`, `src/server/account/`                                    |
| Schema + seed                                | `migrations/0001_init.sql`–`0005_mcp_rate_limit.sql`, `scripts/build-seed.ts`, `data/curation/*` |
| Capture + crawler + Theme Store facts        | `docs/CAPTURE.md`, `docs/CRAWL.md`, `scripts/capture/*`, `scripts/crawl/*`                       |
| Pages                                        | `src/pages/**`, area components in `src/components/<area>/`                                      |
| Admin + auth + security headers              | `src/middleware.ts`, `src/server/auth/`, `src/server/admin/`                                     |

## Gotchas

- `e2e` reads the data it asserts on from `/api/v1/...` (placeholder or captured), so it passes
  both on a fresh `npm run setup` and after `npm run capture:ingest`. Admin e2e needs
  `ADMIN_PASSWORD` exported from `.dev.vars` locally.
- Run Node scripts under `scripts/` with `node` (Node 22+ type stripping): no TypeScript
  parameter properties or enums.
- `npm run capture:ingest` writes the local D1 through Wrangler's platform proxy: stop `astro dev`
  first (or restart it afterwards) so it sees the new rows.
- New migrations on a local D1 that holds captures: `npx wrangler d1 migrations apply DB --local`
  (keeps the data); `npm run setup` rebuilds from the seed and drops ingested captures.
- Account e2e needs `DEV_SIGN_IN=1` + `USER_SESSION_SECRET` (+ `WHOP_WEBHOOK_SECRET`,
  `WHOP_PRO_PRODUCT_ID` for the webhook test) in `.dev.vars`; it skips itself otherwise.
- Astro ≥6 removed `Astro.locals.runtime`; use `import { env } from 'cloudflare:workers'`.
- Astro 7 runs `astro dev`/`astro preview` as managed **background** processes when it detects an
  AI agent (`AI_AGENT`/`CLAUDECODE` env). Unset those env vars or use `npx astro dev status|stop`.
- Astro drops whitespace at line breaks next to inline tags/expressions (`word.{expr}` →
  "word.How"). Add `{' '}` explicitly and eyeball rendered text.
- D1 free plan: 50 queries (statements) per request. Never call an endpoint once per row; run
  `npm run budget:queries` before review (fails above 45).
- App Store icons are still hotlinked from `cdn.shopify.com` (future nice-to-have: mirror to R2).
