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
| `listSections`                         | `GET /api/v1/sections`                | Filters `type group page_type device theme app store`; facets per filter; cursor.                                                                                                  |
| `listSectionTypes`                     | `GET /api/v1/section-types`           | Taxonomy + counts + a preview crop each.                                                                                                                                           |
| `getSection`                           | `GET /api/v1/sections/{id}`           | Section, its full screenshot (all sections), more like this.                                                                                                                       |
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
- Derived tables (`stores.current_*`, `list_position`, `app_stats`, `theme_stats`,
  `app_co_installs`, `theme_app_usage`, `store_similar`, `search_index`) are rebuilt by the same SQL
  at seed time and at runtime: `rebuildDerived(db)` in `src/server/repo/maintenance.ts`.
- Opt-out: `optOutStore(db, domain)` (`src/server/repo/opt-out.ts`) sets `status = 'opted_out'`,
  writes a tombstone, rebuilds derived data and returns the R2 keys to delete. Every public query
  filters `stores.status = 'active'`.

## Admin namespace

Not part of the public API. The router can mount a guarded namespace:
`createApiHandler(deps, { mounts: [{ prefix: 'admin', endpoints, guard }] })` serves
`/api/v1/admin/*` with `no-store` and no CORS; `guard(request, ctx)` returns an `ApiError` to
deny. A dedicated `src/pages/api/v1/admin/[...path].ts` route also works (more specific routes win).

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
