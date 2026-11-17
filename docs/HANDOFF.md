# Handoff

_Last updated: 17 Nov 2026 (base build session). Update this file before stopping for any reason._

## Status
Base build in progress. Work is being split into a stack of focused PRs (see "PR stack" below).

## How to run
```bash
npm install
npm run setup        # builds the seed SQL and loads it into the local D1 (.wrangler/state)
npm run dev          # http://localhost:4321  (Astro 7 SSR inside workerd, local D1 + R2)
```
Checks: `npm run lint`, `npm run check`, `npm test`, `npm run build && npm run size`,
`npm run test:e2e` (Playwright at 390px and 1440px against `astro preview`).
Living styleguide: `/design-system`.

## Done
- Scaffold: Astro 7 + `@astrojs/cloudflare` 14 (Workers, D1 `DB`, R2 `MEDIA`), runs fully locally.
- Design system: tokens, fonts (Instrument Sans / Newsreader / Geist Mono, self-hosted), UI,
  media and domain components, placeholder screenshot renderer, styleguide page.
- Quality gates: project lint rules (brand name, affiliate URLs, secrets), Playwright layout
  harness, size budgets, CI workflow.

## In progress
- Data layer + API v1, page groups (home/search, themes, apps/compare/alternatives,
  stores/teardowns, sections, static/legal/account/pro, admin).

## PR stack
_(filled in when PRs are opened)_

## Next
- Capture pipeline (Playwright, outside the Worker) writing to R2 + `screenshots`/`sections`.
- Mirror App Store icons to R2 (they are hotlinked from cdn.shopify.com today).
- Wire Whop for Pro; accounts + boards on the existing `users`/`collections` tables.
- MCP server wrapping the `/api/v1` endpoint definitions.

## Open questions for the owner
_(see the end of the session summary; mirrored here when the session ends)_

## Gotchas
- Astro ≥6 removed `Astro.locals.runtime`; use `import { env } from 'cloudflare:workers'`.
- Lazy images need a definite box before load (see `SectionCrop`), or they never load.
- `npm run setup` resets the local D1; restart the dev server afterwards.
