# Handoff

_Last updated: 17 Nov 2026, end of the base-build session. Update this file before stopping for any
reason._

## Current work — SaaS redesign (PR #12, branch `feat/12-saas-redesign`)

Owner direction (Muneeb, after the base build): move from the editorial "specimen archive" look to
a **modern SaaS** look at Linear / Vercel / Stripe / Raycast / Framer / Attio polish — clear value-prop
hero with product visuals, crisp nav, strong type, cards, subtle gradients and depth, smooth
micro-interactions, polished Pro pricing, proper light **and dark** themes, equal quality at 1440
and 390. Still nothing AI-looking or templated. Keep all data, routes, features and tests working.

Plan (stacked on #11; no merge, no deploy):

1. Mobbin research of top SaaS sites → `docs/design/direction.md` rewritten (v2, SaaS).
2. Design-system rebuild: tokens (light + dark via `prefers-color-scheme` and a toggle), type,
   cards, depth, motion, header/footer, hero patterns; `/design-system` updated.
3. Every page redesigned in parallel by area (home+search, stores+teardowns, themes, apps,
   compare+alternatives, sections, static/legal/account/pro, admin), each checked at 390/1440.
4. Full gate (lint, astro check, unit, build, size, e2e) → PR #12 with screenshots.

Status: see the newest commits on `feat/12-saas-redesign`; this section is updated as steps land.

## Status

The base build is complete and split into a stack of 11 focused PRs (below). Every section and page
from `docs/BRIEF.md` exists, runs on the seed data through the versioned API, and is checked at
390px and 1440px. Nothing is deployed and no cloud resources were created.

## How to run

```bash
npm install
npm run setup        # builds .data/seed.sql and loads it into the local D1 (.wrangler/state)
npm run dev          # http://localhost:4321  (Astro 7 SSR inside workerd, local D1 + R2)
```

- Checks: `npm run lint` (project rules + Prettier), `npm run check` (astro check), `npm test`
  (Vitest, 111 tests), `npm run build && npm run size`, `npm run test:e2e` (Playwright, ~410 tests at
  390px and 1440px against `astro preview`).
- Screenshots of any routes: `npm run screens -- --base http://127.0.0.1:4321 / /themes`.
- Living styleguide: `/design-system`. Admin: `/admin` (local password lives in your own
  `.dev.vars`; see `.dev.vars.example` for the variable names).

## Where things are

| Area                                                       | Read first                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Visual direction ("specimen archive")                      | `docs/design/direction.md`, then `docs/DESIGN.md`, `/design-system`                      |
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

1. **Brand**: `SITE_NAME` is a placeholder ("Vitrine"). Avoid "Shopify" in the brand/domain
   (trademark rules).
2. **Data to verify**: editorial store names/categories/countries (`data/curation/stores.json`),
   app short names (`data/curation/apps.json`), detection slug `trustpilot` maps to "Trustgear"
   (likely a wrong match), the Hyper affiliate link has no program.
3. **Legal**: review `/privacy` and `/terms` drafts (entity, governing law, retention), the removal
   SLA ("within 3 business days", `REMOVAL_SLA` in `src/components/static/content.ts`), and who is
   notified of new removal requests.
4. **Pro**: what Free includes (draft: home-page captures only), Team seats and yearly price,
   lifetime deal terms.
5. **Admin**: keep password sign-in as a break-glass when Cloudflare Access is on? Should a
   "screenshots only" removal also block recapture (needs a schema flag)? Admin JSON endpoints for
   scripts/MCP?
6. **Product calls**: home statement copy; should specimen numbers be unique when usage ties;
   `/compare` breadth (all same-category pairs for SEO?); teardown byline; filtered `/stores`
   defaulting to all detected stores.
7. **Screendesign**: the connector needs its billing fixed to be usable.

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
- D1 free plan: 50 queries per request — keep list pages to batched queries (the theme index does
  not call `getTheme` per row for this reason).
- The dev server hot-reloads on every file save; e2e runs during heavy editing can flake with
  "execution context destroyed". Rerun when quiet.
