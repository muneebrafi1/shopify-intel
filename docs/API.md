# API (v1)

One versioned API serves the website, the public JSON API and (later) the MCP server.

## Design: an endpoint is a typed definition

Every endpoint is a `defineEndpoint({ id, method, path, input, output, handler })` in
`src/server/api/v1/endpoints/*`: a zod input schema, a zod output schema and a handler. Everything
else is derived from that one definition:

| Consumer           | How it uses the definition                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP (`/api/v1/*`) | `router.ts` matches the path, coerces query strings / form fields to the input schema's types, validates, runs the handler, writes the envelope with caching, ETag and CORS. |
| Astro pages        | `client.ts`: the same handlers called in-process (no HTTP hop): same validation, same envelope, same errors.                                                                 |
| OpenAPI            | `openapi.ts` turns the schemas into an OpenAPI 3.1 document (`z.toJSONSchema`) at `/api/v1/openapi.json`.                                                                    |
| MCP (later)        | Wrap `endpointList`: `id` → tool name, `input` → tool schema, `summary`/`description` → tool docs.                                                                           |

Adding an endpoint = add a definition and list it in `registry.ts`.

## Using it from pages

```ts
import { api, orNotFound } from '~/server/api';
import type { StoreDetail, ThemeListItem } from '~/server/api/v1/types';

const { data: store, meta } = await api.getStore({ domain: Astro.params.domain! });
const { data } = await api.listSections({ type: 'reviews', device: 'mobile', limit: 24 });
const cmp = await orNotFound(api.getComparison({ pair: Astro.params.pair! })); // null on 404
if (cmp && !cmp.data.is_canonical) return Astro.redirect(cmp.data.href, 301);
```

- Every method returns `{ data, meta }` (see below) and throws `ApiError` (`code`, `status`,
  `details`) on errors. `orNotFound()` turns a 404 into `null`.
- Methods are named after the endpoint `id` (table below). Inputs are typed (`limit` is a
  number, `curated` a boolean); optional inputs can be omitted.
- Rate-limited endpoints take the client IP: `api.createRemovalRequest(input, { request: { ip } })`.
- All response types are exported from `~/server/api/v1/types` (inferred from the schemas).
- Tests/scripts build their own client: `createApiClient({ db: openNodeDb() })`.

## Endpoints

| id                                     | Method + path                         | Notes                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index`                                | `GET /api/v1`                         | Endpoint list.                                                                                                                                                                     |
| `getMeta`                              | `GET /api/v1/meta`                    | Provenance + counts (stores scanned/curated/captured, themes, apps, sections…).                                                                                                    |
| `search`                               | `GET /api/v1/search?q=&kinds=&limit=` | FTS5 prefix match per word, grouped by kind; empty `q` = popular suggestions.                                                                                                      |
| `listStores`                           | `GET /api/v1/stores`                  | Filters `theme app category currency country curated captured q`; `sort=rank\|apps\|recent\|domain`; facets; keyset cursor.                                                        |
| `getStore`                             | `GET /api/v1/stores/{domain}`         | Theme + history, apps by category (+ where each shows up), unresolved count, pixels, pages → desktop/mobile screenshots → sections, similar stores, teardown, provenance.          |
| `listThemes`                           | `GET /api/v1/themes`                  | Filters `price=free\|paid`, `price_band`, `vendor`, `q`; `sort=usage\|name\|price`; vendor + price-band facets; up to 3 previews each.                                             |
| `getTheme`                             | `GET /api/v1/themes/{slug}`           | Facts, CTA, versions, curated stores' shots, first page of stores, top apps, sections, similar themes, presets, comparisons.                                                       |
| `listThemeStores`                      | `GET /api/v1/themes/{slug}/stores`    | All detected stores on a theme (cursor).                                                                                                                                           |
| `listApps`                             | `GET /api/v1/apps`                    | Filters `category price built_for_shopify min_rating profile q`; `sort=usage\|rating\|reviews\|name`; category facets.                                                             |
| `listAppCategories`                    | `GET /api/v1/app-categories`          | Counts, reach, surfaces, top apps.                                                                                                                                                 |
| `getApp`                               | `GET /api/v1/apps/{slug}`             | App Store facts (+ `checked_on`), seen on (curated stores + attributed crops), stores, co-installs, alternatives, comparisons, themes. Alias slugs resolve (see `meta.canonical`). |
| `listAppStores`                        | `GET /api/v1/apps/{slug}/stores`      | All stores running the app (cursor).                                                                                                                                               |
| `listSections`                         | `GET /api/v1/sections`                | Filters `type group page_type device theme app store`; `sort=id\|mixed` (mixed = stable shuffle across stores, the library order); facets per filter; cursor.                      |
| `listSectionTypes`                     | `GET /api/v1/section-types`           | Taxonomy + counts (sections, distinct stores, themes) + a preview crop each.                                                                                                       |
| `getSection`                           | `GET /api/v1/sections/{id}`           | Section, its full screenshot (all sections), more like this, position in its type (`in_type`: prev/next in library order).                                                         |
| `getScreenshot`                        | `GET /api/v1/screenshots/{id}`        | Shot + all sections (viewer and placeholder renderer).                                                                                                                             |
| `listTeardowns` / `getTeardown`        | `GET /api/v1/teardowns[/{slug}]`      | Detail embeds the store detail; notes resolve to sections.                                                                                                                         |
| `getComparison`                        | `GET /api/v1/compare/{a}-vs-{b}`      | Two apps or two themes, any pair. Non-alphabetical order → `is_canonical: false` + `meta.canonical` to 301 to. Both detail objects, shared stores, facts matrix.                   |
| `listComparisons`                      | `GET /api/v1/comparisons?kind=&slug=` | Popular pairs (top 3 apps per category, top themes, same-vendor themes).                                                                                                           |
| `getAlternatives` / `listAlternatives` | `GET /api/v1/alternatives[/{slug}]`   | Apps (same category by usage) and themes (vendor, price, shared apps).                                                                                                             |
| `createRemovalRequest`                 | `POST /api/v1/removal-requests`       | JSON or form-encoded. Honeypot `website`, rate limit per hashed IP (5/hour) and per domain (20/day). Returns a `RR-XXXXXXXX` reference.                                            |
| —                                      | `GET /api/v1/openapi.json`            | OpenAPI 3.1.                                                                                                                                                                       |

Site routes outside the API: `/go/{id}` (affiliate redirect: counts an anonymous click per link and
day, then 302; inactive/unknown → 404; `X-Robots-Tag: noindex`) and `/media/{r2 key}` (R2 objects,
immutable caching). The `href`s the API returns are defined in one place,
`src/server/api/v1/hrefs.ts`.

## Envelope, errors, caching

```jsonc
{ "data": { … },
  "meta": { "api_version": "v1", "data_version": "4eeae0255c64", "data_as_of": "2026-11-17",
            "sources": { "storepeek-scan-2026-11-17": { "label": "…", "as_of": "2026-11-17", "url": "/methodology" },
                         "shopify-app-store": { … }, "editorial": { … }, "capture-plan": { … } },
            "pagination": { "limit": 24, "next_cursor": "WzI0XQ", "total": 930 },   // lists only
            "canonical": "/stores/youngla.com" } }                                     // details only
```

- **Every number has a source and date.** Usage stats are `UsageStat { stores, share, denominator,
rank, source, as_of }`; `source` is a key of `meta.sources`. App Store facts carry
  `facts_source` + `checked_on`; comparison rows carry `source`.
- **Ranks are competition ranks** (owner decision): equal usage shares a rank and the next rank
  skips (1, 2, 2, 4). `usage.rank` is the overall rank among public apps (or themes); app list
  items also carry `category_rank` (same rule, within the app's category). Hidden apps/themes take
  no rank. Ties are listed by name (case-insensitive), then slug. Pages that number a list in
  memory use `competitionRanks()` from `src/lib/rank.ts` instead of the row index.
- Errors: `{ "error": { "code", "message", "details?" } }` with 400 (`validation_error`,
  `bad_request`), 404, 405 (+`Allow`), 413, 415, 429 (+`Retry-After`), 500.
- GET: `Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=86400`,
  `ETag: W/"<API_REVISION>-<data_version>"` (304 on `If-None-Match`), CORS `*`, canonical `Link`.
  POST: `no-store`, no CORS.
- Pagination: opaque `cursor`. Stores/sections/theme-stores/app-stores use keyset ("seek")
  cursors; the small theme/app catalogues use offset cursors.
- Responses are schema-validated in dev and tests (`validateOutput`), not in production (CPU).

## Visual model: screenshots, sections, placeholders

- A screenshot is a full page at `viewport_w` (desktop 1440, mobile 390); `width`/`height` are CSS
  px. `image.src` is `/media/<r2_key>` once captured, else `/media/placeholder/shot/<id>.svg`.
- A section is a rectangle on it: `rect { x, y, w, h }`. Most span the full width. Desktop has
  two-column rows: product-gallery | buy-box, sidebar filters | product-grid and split carts
  (cart-items | cart-summary) share `y` and `h` and carry `column: 'left' | 'right'`; on mobile they
  stack. Page height = max(y + h). `crop.src` is `/media/<r2_key_crop>` or
  `/media/placeholder/section/<id>.svg`, with the crop's size.
- `hints` are renderer hints (`{ style: 'split' }`, `{ columns: 4 }`, `{ layout: 'sidebar' }`…).
- **Placeholders** (`is_placeholder: true`, `captured_at: null`) are the capture plan for the 20
  curated stores: home, collection, product, cart × desktop, mobile, with a deterministic layout
  from `scripts/seed/layout.ts`. Sections are attributed to an app only when the store has it and
  the app's category lists that section type as its primary surface (`APP_CATEGORY_SURFACES`); the
  most-used app wins. Real captures replace these rows; `theme_section_name` stays null until real.
  Cart pages are intentionally short (1–4K px), like real carts.

## Data pipeline

```
npm run db:build-seed   # data/seed + data/curation → .data/seed.sql (deterministic; prints warnings)
npm run db:reset        # local D1 only: delete .wrangler/state/v3/d1, apply migrations, load seed
npm run setup           # both; restart a running dev server afterwards
npm test                # vitest on node:sqlite (migrations + generated seed in memory)
```

- Schema: `migrations/0001_init.sql` (commented). Detection tables are append-only history.
- Usage numbers are computed from `detections-930.json` (single source of truth) and checked
  against the export's numbers; mismatches are printed.
- Editorial inputs live in `data/curation/`: `stores.json` (names, categories, countries),
  `apps.json` (short display names), `teardowns/*.md` (format documented in
  `scripts/seed/teardowns.ts`; notes reference `page_type`/`device`/`section_type` and are resolved
  to section ids at build time).
- Corrections to the raw exports live in `data/curation/overrides.json`, never in `data/seed/`
  (those files are re-exported): `unmatchDetectionSlugs` drops a wrong App Store match so the
  slug's detections stay unresolved (counted, attributed to no app; currently `trustpilot`, which
  the export matched to the unrelated "Trustgear" listing), and `dropAffiliateLinks` skips a link
  (currently theme `hyper`, which has no program). A dropped link's position-based id stays unused,
  so `/go/<id>` 404s for it and every other link id is unchanged. The build prints a warning per
  applied override and for stale ones. Owner-approved drafts.
- Derived tables (`stores.current_*`, `list_position`, `app_stats`, `theme_stats`,
  `app_co_installs`, `theme_app_usage`, `store_similar`, `search_index`) are rebuilt by the same SQL
  at seed time and at runtime: `rebuildDerived(db)` in `src/server/repo/maintenance.ts`.
- Opt-out: `optOutStore(db, domain)` (`src/server/repo/opt-out.ts`) sets `status = 'opted_out'`,
  writes a tombstone, rebuilds derived data and returns the R2 keys to delete. Every public query
  filters `stores.status = 'active'`.

## Admin API (`/api/v1/admin/*`)

Protected JSON endpoints for scripts and the future MCP server, built from the same typed
definitions as the public API (zod in → handler → zod out) in `src/server/admin/api/`. They are
**not** in the public `/api/v1/openapi.json` or the public index: the admin schemas live in their
own registry and the admin document is served only behind the guard at
`GET /api/v1/admin/openapi.json`. Responses are `Cache-Control: no-store`, no CORS, and every change
goes through an existing admin action, so it is written to the audit log (`admin_audit`) with the
caller as the actor.

**Auth** (checked by `src/middleware.ts` and again by the router's admin mount,
`src/server/admin/api/mount.ts`). Any one of:

| Credential                                | Who                              | Notes                                                                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Access JWT (header or cookie)  | the owner in a browser (primary) | Verified against the team's keys (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`). Writes must be same-origin. Scripts behind Access also need an Access service token, whose JWT is accepted the same way.                    |
| Password session cookie (`/admin/login`)  | break-glass backup               | Works next to Access when `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` are set (owner decision); locally it is the only method. Writes must be same-origin (`Origin` header), else **403**.                                 |
| `Authorization: Bearer <ADMIN_API_TOKEN>` | scripts, MCP                     | Compared in constant time. **Off** when `ADMIN_API_TOKEN` is unset or shorter than 32 characters. With an `Authorization` header only the token counts (a wrong one is **401**, never a cookie fallback). No CSRF check. |

Without valid credentials every path under `/api/v1/admin` (including unknown ones and the
OpenAPI document) answers `401 {"error":{"code":"unauthorized",…}}`; a cookie-authenticated write
from another origin answers `403 forbidden`. Admin errors also use `409 conflict` (already
handled, already queued, capture blocked, …) and `500` when media deletion failed after an approval
(retry with `action: "complete"`). Failed actions put their result key in
`error.details[0].message` (e.g. `capture_blocked`).

| id                            | Method + path                                                          | Notes                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adminIndex`                  | `GET /api/v1/admin`                                                    | Who you are (`principal`) and the endpoint list.                                                                                                                              |
| `adminListRemovalRequests`    | `GET /api/v1/admin/removal-requests?status=&page=&limit=`              | `status` = `pending` \| `approved` \| `rejected` \| `done`. Includes the requester email (personal data; kept 2 years).                                                       |
| `adminGetRemovalRequest`      | `GET /api/v1/admin/removal-requests/{id}`                              | Request, capture block, and what approving would retire/delete.                                                                                                               |
| `adminUpdateRemovalRequest`   | `POST /api/v1/admin/removal-requests/{id}`                             | `{ action: "approve", confirm: true, note? }` · `{ action: "reject", note }` · `{ action: "complete" }`. Approving scope `store` or `screenshots` **blocks future captures**. |
| `adminPurgeRemovalRecords`    | `POST /api/v1/admin/maintenance/purge-removal-records`                 | `{ dry_run? }`. Deletes records closed more than 730 days ago; keeps capture blocks. Safe to run daily.                                                                       |
| `adminListCaptureBlocks`      | `GET /api/v1/admin/capture-blocks?page=&limit=`                        | Every domain that must never be captured (blocks + tombstones).                                                                                                               |
| `adminGetCaptureStatus`       | `GET /api/v1/admin/capture-status/{domain}`                            | `{ domain, blocked, block }`. The capture pipeline calls it before each capture.                                                                                              |
| `adminListCaptureTargets`     | `GET /api/v1/admin/capture-targets?scope=curated\|all&limit=&cursor=`  | The capture pipeline's only work list: active, not tombstoned, not blocked.                                                                                                   |
| `adminUpdateStore`            | `POST /api/v1/admin/stores/{domain}`                                   | `{ name?, category?, country?, status?: "active"\|"hidden", curated? }`; only fields sent change.                                                                             |
| `adminQueueJob`               | `POST /api/v1/admin/jobs`                                              | `{ domain, kind: "detect"\|"rescan"\|"capture", priority? }` → 201; captures of blocked domains → 409.                                                                        |
| `adminCancelJob`              | `POST /api/v1/admin/jobs/{id}/cancel`                                  | Queued jobs only.                                                                                                                                                             |
| `adminUpdateTheme`            | `POST /api/v1/admin/themes/{slug}`                                     | `{ name?, price_label?, marketplace?, status? }`.                                                                                                                             |
| `adminUpdateApp`              | `POST /api/v1/admin/apps/{slug}`                                       | `{ name?, category? (slug), tagline?, status? }`.                                                                                                                             |
| `adminSetTeardownPublished`   | `POST /api/v1/admin/teardowns/{slug}`                                  | `{ published: boolean }`.                                                                                                                                                     |
| `adminListAffiliateLinks`     | `GET /api/v1/admin/affiliate-links`                                    | With click counts (total, 30 days).                                                                                                                                           |
| `adminCreateAffiliateLink`    | `POST /api/v1/admin/affiliate-links`                                   | `{ target_type, target_slug, url (https), label?, program_id?, active? }` → 201.                                                                                              |
| `adminUpdateAffiliateLink`    | `POST /api/v1/admin/affiliate-links/{id}`                              | `{ url?, label?, program_id?, active? }`; inactive links 404 at `/go/<id>`.                                                                                                   |
| `adminUpdateAffiliateProgram` | `POST /api/v1/admin/affiliate-programs/{id}`                           | `{ status }`.                                                                                                                                                                 |
| `adminListAudit`              | `GET /api/v1/admin/audit?limit=&target_type=&target_id=&include_auth=` | Recent audit rows, `detail` parsed.                                                                                                                                           |
| —                             | `GET /api/v1/admin/openapi.json`                                       | OpenAPI 3.1 for the admin namespace (guarded).                                                                                                                                |

Examples (placeholder token; never paste a real one into docs, commits or chat):

```bash
TOKEN=replace-with-your-ADMIN_API_TOKEN   # from your own secret store
BASE=http://localhost:4321/api/v1/admin

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/removal-requests?status=pending"
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"approve","confirm":true,"note":"Owner verified"}' "$BASE/removal-requests/12"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/capture-status/example.com"
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"dry_run":true}' "$BASE/maintenance/purge-removal-records"
```

Mounting: `createApiHandler(deps, { publicRoutes: false, mounts: [createAdminMount({ authConfig,
apiToken })] })` (`src/server/admin/api/worker.ts`, used by `src/pages/api/v1/admin/[...path].ts`).
A mount's `guard(request, ctx)` returns an `ApiError` to deny or the `Principal` it authenticated;
handlers read it from `ctx.request.principal` for the audit log. The guard runs before anything
else in the namespace (404s, 405s and the OpenAPI document included).

## Scale notes (50K stores, 100K+ screenshots)

- Lists read denormalised columns on `stores` (current theme, app count, capture flag,
  `list_position`) with composite indexes, and seek with keyset cursors: page 1,000 costs the same
  as page 1. Sections carry denormalised `store_id/page_type/device/theme_id/is_current`, so
  library filters never join.
- Trade-off: list `total`s and facet counts are live `COUNT`/`GROUP BY`s over the filtered set
  (≈ rows matched per request). Fine at 50K stores with edge caching; at 1M+ sections, add rollup
  tables for section facets (type × page × device × theme) and use `app_stats`/`theme_stats`
  totals for single-filter lists. Unfiltered app facets already come from `app_stats`.
- The app filter on store lists uses `EXISTS` on `store_apps(app_id, …)`; for very rare apps,
  driving the query from `store_apps` would be cheaper.
- `rebuildDerived` is a full rebuild. The co-install and similar-store self-joins grow with
  (apps per store)² and theme size²; at 50K stores move them to the offline ingest job or update
  incrementally per changed store. D1 batches have time limits.
- Category reach (`listAppCategories`) scans open detections once; cache it.
- Search is FTS5 with prefix indexes (`prefix='2 3'`).
- Placeholder SVGs and R2 media are immutable per key/data version; API responses get
  `s-maxage` + ETag by `data_version`. Next step: Cache API keyed by URL + data_version.
