# Architecture

This describes what the base build implements. The original proposal is kept at the bottom;
where we diverged, the reason is given here.

## Stack

| Layer            | Choice                                                                                                                                             | Why                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web app          | **Astro 7, server-rendered on Cloudflare Workers** (`@astrojs/cloudflare` 14)                                                                      | Content-heavy, image-first site: HTML from the edge, almost no client JS (vanilla `<script>` islands, no UI framework). Dev runs _inside workerd_ via the Cloudflare Vite plugin, so local == production runtime.                          |
| Data             | **D1** (`DB` binding), SQL migrations in `migrations/`                                                                                             | Free tier, SQLite semantics, FTS5 for search. Plain SQL behind a tiny `Db` interface (no ORM) so the same queries run on D1 and on `node:sqlite` in tests/scripts.                                                                         |
| Screenshots      | **R2** (`MEDIA` binding) served by `/media/<key>`; drawn placeholders at `/media/placeholder/...`                                                  | See "Screenshot pipeline".                                                                                                                                                                                                                 |
| API              | **`/api/v1/*`**: typed endpoint definitions (zod in → handler → zod out)                                                                           | One definition serves three transports: HTTP (`/api/v1`), the in-process client used by every page, and (later) the MCP server. OpenAPI 3.1 is generated from the same definitions at `/api/v1/openapi.json`. Details: [`API.md`](API.md). |
| Search           | D1 **FTS5** `search_index`, prefix queries, grouped results                                                                                        | Works at 50K+ rows without a build step (Pagefind would need re-indexing on every ingest). Palette (⌘K) + `/search`.                                                                                                                       |
| Admin            | `src/middleware.ts` guards `/admin` and `/api/v1/admin`: **Cloudflare Access JWT** in production or a **signed session cookie** (password) locally | Server-side only; same-origin check on writes; audit log.                                                                                                                                                                                  |
| Affiliate        | `/go/:id` → counts the click per day (no personal data) → 302                                                                                      | Links live in the DB (`affiliate_links`), labelled in the UI, `rel="sponsored"`.                                                                                                                                                           |
| Payments (later) | Whop                                                                                                                                               | Stripe isn't available in Pakistan. Accounts/boards tables exist; UI slots are routed.                                                                                                                                                     |

### Why the website calls the API in-process instead of over HTTP

A Worker fetching its own public URL adds a network hop and double billing, and on Workers
self-fetches are awkward. The in-process client calls the _same endpoint definitions_ the HTTP
router uses (same input validation, same output schema), so the site is guaranteed to see
exactly what API/MCP consumers see, without the hop. The MCP server will import the same
definitions (or call the HTTP API from elsewhere).

## Screenshot pipeline (designed now, captures later)

- Every capture is a row in `screenshots` (page × device) with its sections in `sections`
  (`section_type`, `y`, `height`, optional `app_id`). Real captures have an `r2_key`
  (`shots/{domain}/{page_type}/{device}/{captured_at}.webp`).
- Until the capture pipeline runs, the seed creates **placeholder captures** for the 20 curated
  stores (home/collection/product/cart × desktop/mobile) with plausible section layouts
  (deterministic, flagged `is_placeholder`). `/media/placeholder/shot/<id>.svg` draws them from
  their section rows in the store's muted tone (`src/server/media/placeholder-svg.ts`).
- The UI never knows the difference: tiles request the top slice (`?h=` for placeholders,
  Image Resizing `fit=crop,gravity=top` for R2 once enabled — `src/lib/media.ts`), the
  full-page viewer positions section outlines in percentages of the capture height, and section
  crops come from `r2_key_crop` or the same renderer with a crop. **A real capture drops in by
  writing its R2 key and section rows; no UI change.**
- A slim sitewide notice (`SHOW_CAPTURE_PREVIEW_NOTICE` in `src/config/site.ts`) says
  screenshots are previews until the first capture run.

### Capture blocks: the contract the capture pipeline must follow

Owner decision (draft): a removal request of scope `screenshots` (and of course `store`) also
**stops all future captures** of that store. Approving such a request in the admin (or through
`POST /api/v1/admin/removal-requests/{id}`) writes a row in `capture_blocks`
(`migrations/0002_capture_block.sql`) in the same batch as the approval, cancels queued capture
jobs, and makes `queueJob(kind: 'capture')` refuse the domain (`capture_blocked`). Tombstoned
domains (whole-store opt-outs) count as blocked too. Detection rescans are not blocked for
`screenshots` requests: the store stays listed with its theme and apps.

The pipeline (a separate job, not part of the Worker) must:

1. Take its work list only from `listCaptureTargets(db, { scope, limit, after })` in
   `src/server/repo/capture.ts`, or over HTTP `GET /api/v1/admin/capture-targets` (active
   stores, not tombstoned, not blocked; `scope=curated` by default, `scope=all` for every
   detected store; keyset paging with `after`).
2. Re-check right before each capture with `isCaptureBlocked(db, domain)` or
   `GET /api/v1/admin/capture-status/{domain}` (`{ blocked: true }` → skip): a request can be
   approved while a run is in progress.
3. On ingest, re-check `isCaptureBlocked()` once more and discard (never store in R2) anything
   for a blocked domain.

Blocks are permanent. They hold no personal data and **outlive the removal request record**:
when the record is purged after two years (below), the block stays, with its `RR-…` reference
and `removal_request_id` set to NULL. There is no "unblock" action yet; lifting a block (for an
owner who asks to be listed again) is a manual, audited database change for now.

## Local development and CI

- `npm run setup` builds seed SQL from `data/seed/*.json` + `data/curation/*` and loads it into
  the local D1 (`wrangler d1 ... --local`). No cloud resources are created.
- CI (`.github/workflows/ci.yml`): seed JSON validation, project lint rules
  (`scripts/lint-rules.mjs`: brand name only in `SITE_NAME`, no affiliate URLs or secrets in
  source), Prettier, `astro check`, Vitest (API handlers against the seeded DB on
  `node:sqlite`), build, size budgets (`scripts/size-budget.mjs`), and Playwright at 390px and
  1440px against the built Worker (status, one h1, no horizontal overflow, no JS errors, named
  controls, alt text).

## Deploying (for the owner — nothing has been deployed)

1. `npx wrangler d1 create shopify-intel` → put the real `database_id` in `wrangler.jsonc`.
2. `npx wrangler r2 bucket create shopify-intel-media`.
3. `npx wrangler d1 migrations apply DB --remote`, then load seed/ingest data.
4. Secrets: `npx wrangler secret put ADMIN_SESSION_SECRET` (and `ADMIN_PASSWORD`, or configure
   Cloudflare Access + `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`), `IP_HASH_SALT`.
5. Set `SITE_NAME`/`SITE_DOMAIN` in `src/config/site.ts`, then `npm run build && npx wrangler deploy`.

## Scaling notes

Unchanged from the proposal below: append-only detection history, precomputed summary tables at
ingest, edge caching keyed by URL + data version, on-demand rendering for the long tail (no
static store pages, so the 20,000-asset limit doesn't apply), opt-out tombstones.

## Original proposal (kept for reference)

This is a starting proposal, not a contract. If you see a better design, change it and explain why
in the PR. Constraints: free Cloudflare tier preferred, scales to 50K+ stores and 100K+ screenshots,
one data layer for both the website and a future MCP server.

## Proposed stack

| Layer                             | Proposal                                                                     | Notes                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web app                           | Astro (or another SSR/SSG framework that runs on Cloudflare Workers)         | Static-render the evergreen pages; render the long tail (store pages) on demand with edge caching. Workers static assets has a 20,000-files-per-version limit.                             |
| Hosting                           | Cloudflare Workers + static assets                                           | Free plan. No deploy yet — config only (`wrangler.toml` / `wrangler.jsonc`).                                                                                                               |
| Relational data                   | **Cloudflare D1** (SQLite)                                                   | Free: 5 GB, 5M rows read/day. Drizzle or plain SQL migrations in `migrations/`.                                                                                                            |
| Screenshots                       | **Cloudflare R2**                                                            | WebP/AVIF, several widths; no egress fees; 10 GB free. Keys like `shots/{store}/{page_type}/{device}/{captured_at}.webp`, sections as crops or rect metadata.                              |
| API                               | Worker routes under `/api/v1/*` (JSON, versioned, documented)                | The website reads the same API/service layer. Future MCP server wraps these same functions.                                                                                                |
| Search                            | Pagefind (static) or D1 FTS5                                                 | Keyboard-first instant search.                                                                                                                                                             |
| Crawler + detection + screenshots | **Outside** the web app: Node/Python + Playwright on a box or GitHub Actions | Reuse StorePeek detection rules (signatures v7). Writes to D1/R2 through an authenticated ingest endpoint or wrangler. Not part of this first build except for the schema/ingest contract. |
| Auth / payments (later)           | Whop for Pro (license/membership checked by a Worker)                        | No Stripe (not available in Pakistan). Leave clean seams.                                                                                                                                  |
| Admin                             | `/admin` behind Cloudflare Access or a server-checked session                | Never rely on client-side checks.                                                                                                                                                          |
| Affiliate clicks                  | `/go/:id` redirect route that logs a click (anonymous) then 302s             | Links stored in DB, labelled as affiliate in UI.                                                                                                                                           |

For the base build, the app should run fully locally from `data/seed/` (e.g. `wrangler dev` with a
local D1 seeded by a script), with placeholder screenshots where real ones don't exist yet.

## Schema sketch

```sql
stores(id, domain UNIQUE, name, url, country, currency, category, tranco_rank,
       status, opted_out_at, first_seen, last_seen, created_at, updated_at)
apps(id, slug UNIQUE, app_store_handle, name, developer, category, tagline, rating, reviews,
     pricing_json, icon_url, app_store_url, built_for_shopify, checked_on)
themes(id, slug UNIQUE, name, vendor, theme_store_id, price_cents, marketplace, official_url)
theme_presets(id, theme_id, name, slug)

-- detection history (never overwrite; close rows instead)
store_apps(store_id, app_id, confidence, first_seen, last_seen, removed_at,
           PRIMARY KEY(store_id, app_id, first_seen))
store_themes(store_id, theme_id, preset_id, version, raw_name, first_seen, last_seen, replaced_at)
scans(id, store_id, ran_at, rules_version, http_status, raw_json)

-- visual library
pages(id, store_id, page_type /* home|collection|product|cart|search|blog|article|page|404 */,
      url, captured_at)
screenshots(id, page_id, device /* desktop|mobile */, viewport_w, full_height,
            r2_key, width, height, bytes, captured_at, theme_id, is_current)
sections(id, screenshot_id, section_type /* header|hero|reviews|footer|... */,
         y, height, r2_key_crop, app_id NULL, theme_section_name, order_index)
section_tags(section_id, tag)  -- style/colour/layout tags, e.g. 'dark', 'carousel', 'sticky'

-- content & money
teardowns(id, store_id, slug, title, body_md, published_at)
comparisons(id, app_a_id, app_b_id, slug, body_md)   -- or generated on demand
affiliate_programs(id, name, network, status)
affiliate_links(id, target_type /* app|theme|vendor */, target_id, program_id, url, active)
clicks(link_id, day, count)

-- later
users(id, email, whop_member_id, plan, created_at)
collections(id, user_id, name, is_public) ; collection_items(collection_id, item_type, item_id)
removal_requests(id, domain, email, reason, status, created_at, handled_at)
```

## Scaling notes

- Detections are append-only history; "current" views are derived (`last_seen` within N days).
  This powers "recently switched" feeds and trends without schema changes.
- Precompute heavy aggregates (stores per theme, co-installs) into summary tables during ingest,
  not per request.
- Screenshots: store originals once in R2, serve resized variants (Cloudflare Images or
  pre-generated widths). Lazy-load grids; blur-up placeholders.
- Store pages beyond ~20K: server-render on demand + cache, not static files.
- D1 read budget: cache API responses at the edge (Cache API) keyed by URL + data version.
- Keep the API versioned (`/api/v1`) and typed (shared TS types / zod) so the MCP server can reuse
  it unchanged.
- Opt-out: when a store is removed, hide it everywhere, delete its R2 objects, and keep only a
  tombstone so the crawler never re-adds it.

## Seed data

See `data/seed/README.md`. Seed shapes are inputs, not the final schema — map them in a seed script.
