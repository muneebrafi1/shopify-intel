# Architecture (PROPOSAL — Claude may improve it)

This is a starting proposal, not a contract. If you see a better design, change it and explain why
in the PR. Constraints: free Cloudflare tier preferred, scales to 50K+ stores and 100K+ screenshots,
one data layer for both the website and a future MCP server.

## Proposed stack
| Layer | Proposal | Notes |
|---|---|---|
| Web app | Astro (or another SSR/SSG framework that runs on Cloudflare Workers) | Static-render the evergreen pages; render the long tail (store pages) on demand with edge caching. Workers static assets has a 20,000-files-per-version limit. |
| Hosting | Cloudflare Workers + static assets | Free plan. No deploy yet — config only (`wrangler.toml` / `wrangler.jsonc`). |
| Relational data | **Cloudflare D1** (SQLite) | Free: 5 GB, 5M rows read/day. Drizzle or plain SQL migrations in `migrations/`. |
| Screenshots | **Cloudflare R2** | WebP/AVIF, several widths; no egress fees; 10 GB free. Keys like `shots/{store}/{page_type}/{device}/{captured_at}.webp`, sections as crops or rect metadata. |
| API | Worker routes under `/api/v1/*` (JSON, versioned, documented) | The website reads the same API/service layer. Future MCP server wraps these same functions. |
| Search | Pagefind (static) or D1 FTS5 | Keyboard-first instant search. |
| Crawler + detection + screenshots | **Outside** the web app: Node/Python + Playwright on a box or GitHub Actions | Reuse StorePeek detection rules (signatures v7). Writes to D1/R2 through an authenticated ingest endpoint or wrangler. Not part of this first build except for the schema/ingest contract. |
| Auth / payments (later) | Whop for Pro (license/membership checked by a Worker) | No Stripe (not available in Pakistan). Leave clean seams. |
| Admin | `/admin` behind Cloudflare Access or a server-checked session | Never rely on client-side checks. |
| Affiliate clicks | `/go/:id` redirect route that logs a click (anonymous) then 302s | Links stored in DB, labelled as affiliate in UI. |

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
