# Handoff

_Last updated: 17 Nov 2026, end of the SaaS-redesign session. Update this file before stopping
for any reason._

## Status

- **Base build:** complete, as a stack of 11 focused PRs (#1–#11).
- **SaaS redesign + owner decisions:** in **PR #12** (`feat/12-saas-redesign`, stacked on #11).
  - Every page is redesigned in the v2 "product-grade SaaS" direction: light by default, dark
    via the system setting or the header toggle, vermilion accent.
  - Muneeb's answers of 17 Nov are applied as drafts (see the PR body and the table in
    `docs/ARCHITECTURE.md`).
- **Gate (17 Nov):** lint, astro check, 163 unit tests, build, size budgets and 557 e2e passed;
  3 e2e are skipped by design.
- **D1 query budget:** ≤ 38 statements per request on every route.
- Nothing is merged or deployed, and no cloud resources were created.
- After pulling #12, run `npm run setup` (migration `0002_capture_block.sql` and a new seed),
  then restart dev.

## Owner decisions applied in #12 (drafts)

- **Design:**
  - references: Linear, Attio, Stripe, Vercel, Cloudflare, Dovetail, Base44, Twenty;
  - light default, dark by system setting + toggle, vermilion kept;
  - see `docs/design/direction.md`.
- **Legal:**
  - entity Xovist (`LEGAL_ENTITY`);
  - governing law Pakistan;
  - removal records kept 2 years (`purgeExpiredRemovalRecords`);
  - "within 3 business days" stays;
  - new removal requests notify `ADMIN_NOTIFY_EMAIL` (no mail transport yet; it logs without
    personal data).
- **Pro** (`src/components/static/content.ts`):
  - Free: home-page screenshots + basic data;
  - Pro: all page types, full-page and section screenshots, exports, $12/mo or $120/yr;
  - Team: 3 seats, $39/mo or $390/yr;
  - yearly: 2 months free.
- **Admin:**
  - Cloudflare Access is primary, with password sign-in as the break-glass backup;
  - approving a store or screenshots removal blocks future captures (`capture_blocks`);
  - admin API at `/api/v1/admin/*` (Access, password session, or `ADMIN_API_TOKEN`), with its
    own protected OpenAPI document.
- **Product:**
  - home headline unchanged;
  - equal usage shares a rank;
  - `/compare` only renders curated pairs (everything else 404s);
  - teardown byline "Editorial team";
  - `/stores` curated by default (`?scope=all` for every detected store).
- **Data:**
  - `trustpilot` is no longer matched to Trustgear;
  - Hyper's affiliate link is removed;
  - both are done in `data/curation/overrides.json`.

## How to run

```bash
npm install
npm run setup        # builds .data/seed.sql and loads it into the local D1 (.wrangler/state)
npm run dev          # http://localhost:4321  (Astro 7 SSR inside workerd, local D1 + R2)
```

- Checks:
  - `npm run lint` (project rules + Prettier)
  - `npm run check` (astro check)
  - `npm test` (Vitest, 163 tests)
  - `npm run build && npm run size`
  - `npm run test:e2e` (Playwright, 560 tests at 390px and 1440px against `astro preview`)
  - `npm run budget:queries` (dev server up: fails if any route goes over 45 D1 statements)
- Screenshots of any routes: `npm run screens -- --base http://127.0.0.1:4321 / /themes`.
  Add `--theme dark` for dark mode.
- Living styleguide: `/design-system`. Admin: `/admin` (local password lives in your own
  `.dev.vars`; see `.dev.vars.example` for the variable names).

## Where things are

| Area                                                       | Read first                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Visual direction (v2, SaaS, light + dark)                  | `docs/design/direction.md`, then `docs/DESIGN.md`, `/design-system`                      |
| Mobbin research                                            | `docs/design/research.md`                                                                |
| Architecture + why it differs from the proposal            | `docs/ARCHITECTURE.md`                                                                   |
| API (one definition → HTTP, in-process client, future MCP) | `docs/API.md`, `src/server/api/v1/`                                                      |
| Schema + seed                                              | `migrations/0001_init.sql`, `scripts/build-seed.ts`, `scripts/seed/*`, `data/curation/*` |
| Placeholder captures                                       | `src/server/media/placeholder-svg.ts`, `/media/placeholder/...`                          |
| Pages                                                      | `src/pages/**`, area components in `src/components/<area>/`                              |
| Admin + auth                                               | `src/middleware.ts`, `src/server/auth/`, `src/server/admin/`                             |

## PR stack (merge in order; each targets the previous branch)

1. [#1](https://github.com/muneebrafi1/shopify-intel/pull/1) `feat/01-foundation-data-api` — scaffold, tooling, CI, schema, seed, API v1, unit tests
2. [#2](https://github.com/muneebrafi1/shopify-intel/pull/2) `feat/02-design-system` — tokens, components, screenshot system, styleguide
3. [#3](https://github.com/muneebrafi1/shopify-intel/pull/3) `feat/03-home-search` — home, search, command palette
4. [#4](https://github.com/muneebrafi1/shopify-intel/pull/4) `feat/04-stores-teardowns` — stores index/detail (full-page viewer), teardowns
5. [#5](https://github.com/muneebrafi1/shopify-intel/pull/5) `feat/05-themes`
6. [#6](https://github.com/muneebrafi1/shopify-intel/pull/6) `feat/06-apps` — index, categories, detail
7. [#7](https://github.com/muneebrafi1/shopify-intel/pull/7) `feat/07-compare-alternatives`
8. [#8](https://github.com/muneebrafi1/shopify-intel/pull/8) `feat/08-sections` — sections library
9. [#9](https://github.com/muneebrafi1/shopify-intel/pull/9) `feat/09-site-pages` — about, methodology, legal, opt-out, Pro, sign-in/account, developers, 404
10. [#10](https://github.com/muneebrafi1/shopify-intel/pull/10) `feat/10-admin` — protected admin
11. [#11](https://github.com/muneebrafi1/shopify-intel/pull/11) `feat/11-handoff` — this file
12. [#12](https://github.com/muneebrafi1/shopify-intel/pull/12) `feat/12-saas-redesign` — SaaS redesign (light + dark), owner decisions, admin API, D1 query budget

`claude/busy-wright-i74iuv` holds the same final tree with the session's checkpoint history.
PR screenshots live on the `pr-screenshots` branch (images only; never merge it).

## Next

1. **Capture pipeline** (outside the Worker): Playwright on a box/GitHub Actions → R2 keys
   `shots/{domain}/{page_type}/{device}/{captured_at}.webp` + `screenshots`/`sections` rows. When a
   row gets an `r2_key`, the UI switches from the drawn placeholder automatically. Then set
   `SHOW_CAPTURE_PREVIEW_NOTICE = false` (`src/config/site.ts`) and enable Image Resizing
   (`IMAGE_TRANSFORMS` in `src/lib/media.ts`).
2. **Mirror App Store icons to R2** (they are hotlinked from cdn.shopify.com today).
3. **Accounts + Pro via Whop**: `users`, `collections`, `collection_items` exist; UI slots are routed
   (`/sign-in`, `/account`, `/account/boards`, `SaveButton`).
4. **MCP server**: wrap `endpointList` from `src/server/api/v1/registry.ts` (id → tool name, zod
   input → tool schema).
5. Grow data: ingest endpoint for the crawler, theme presets, theme style/industry tags (left empty
   on purpose — no invented data), Tranco source/date in `meta.sources`.
6. API niceties the page engineers asked for: offset/page cursors for deep pagination, an optional
   preview section on app list items, a `listScreenshots` endpoint (the home wall makes 5 calls).

## Open questions for the owner

1. **Brand**: `SITE_NAME` is still the placeholder "Vitrine". Avoid "Shopify" in the brand and
   domain (trademark rules).
2. **Pro details**:
   - Free covers home-page screenshots on desktop and mobile, and filtering by section type only.
     Is that right?
   - What exactly is "full theme and app data" (Pro) compared with "basic" (Free)?
   - Do Team shared boards and Pro theme-switch alerts stay?
   - The lifetime deal ($79, first 100 accounts) is still a draft.
3. **Legal**: still open are the entity address, the refund policy, and a final review of the
   `/privacy` and `/terms` drafts.
4. **Removals and admin**:
   - Capture blocks are permanent, with no unblock in the admin. OK?
   - A purge button in the admin, or the API endpoint only?
   - Retention counts from the decision date and purges only done/rejected requests; audit rows
     are kept.
   - Scripts behind Access will need an Access service token as well as `ADMIN_API_TOKEN`.
5. **Product calls**:
   - A non-curated compare pair returns 404 + noindex. OK, or should it be 200 + noindex?
   - The store page's "Compare" jumps to similar stores, since there is no store-vs-store page yet.
   - The home hero shows the newest teardown's store. Keep that, or fix one store?
   - The latest-captures gallery is static now.
   - The "For builders" block was dropped from home; /developers stays in the footer.
   - Affiliate app CTAs say "Get X", because they go to partner pages.
6. **Design details**:
   - The Pro button uses a deeper vermilion (#cf4519) in light mode so white text passes AA.
   - Store avatars show the store's initial on its tone colour.
7. **Data to verify**:
   - editorial store names, categories and countries (`data/curation/stores.json`)
   - app short names (`data/curation/apps.json`)
8. **Screendesign**: the connector needs its billing fixed to be usable.

## Gotchas

- Astro ≥6 removed `Astro.locals.runtime`; use `import { env } from 'cloudflare:workers'`.
- Astro 7 runs `astro dev`/`astro preview` as managed **background** processes when it detects an
  AI agent (`AI_AGENT`/`CLAUDECODE` env). Use `npx astro dev status|stop`. Playwright's web server
  blanks those variables so preview stays in the foreground (CI is unaffected).
- `npm run setup` recreates the local D1 file; restart the dev server afterwards or every query
  fails with `SQLITE_CANTOPEN`.
- Astro drops whitespace at line breaks next to inline tags/expressions (`word.{expr}` →
  "word.How"). Add `{' '}` explicitly and eyeball rendered text.
- Lazy images need a definite box before load (see `SectionCrop`) or they never load.
- The Workers types hide DOM `Element.append` in client scripts; use `appendChild`.
- D1 free plan: 50 queries (statements) per request. Never call an endpoint once per row: use
  `listSectionsByApps` (one query for a whole grid), `listStores?domains=`, `listApps?slugs=` /
  `listThemes?slugs=` and `facets=false` when only items are shown; details batch per-entity lists
  with window functions. `astro dev` sends `x-d1-queries: <calls>/<statements>` on every response;
  run `npm run budget:queries` (dev server up and idle) before review: it fails above 45. Heaviest
  now: `/stores/<curated>` 38 (getStore + getTeardown, which embeds getStore again).
- The dev server hot-reloads on every file save; e2e runs during heavy editing can flake with
  "execution context destroyed". Rerun when quiet.
