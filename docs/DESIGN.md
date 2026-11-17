# Design system

The living reference is **`/design-system`** (run `npm run dev` and open it). Every shared
component is shown there with fixture data. This document explains the rules behind it.
**The visual concept and signature elements are in [`design/direction.md`](design/direction.md)
— read that first; it is binding.**
Reference research (Mobbin) is in [`docs/design/research.md`](design/research.md).

## Principles
1. **Image-first, quiet interface.** Screenshots carry the colour; the UI is warm neutrals with
   one accent. If a page looks busy, remove chrome before adding anything.
2. **Show, don't claim.** No hero slogans over stock art. Lead with real store pages and real
   numbers. Copy is short, plain and specific ("Seen on 221 of 930 scanned stores").
3. **Every number has a source and a date.** Use `<Stat source asOf>` or `<SourceNote>`. Never
   invent revenue, traffic or "growth".
4. **Honest states.** Placeholder captures are drawn from detected sections and labelled as
   such; uncaptured stores say "Not captured yet"; empty filters say what to change.
5. **Never look AI-generated.** No gradients (except functional fades), glass, emoji, icon-in-a-
   circle feature grids, "Unlock the power of…", or decorative 3D. No coloured "winner"
   columns. Accent is for state (focus, selection, current section), not decoration.

## Tokens (`src/styles/tokens.css`)
- **Colour:** `--bg` page, `--surface` cards/popovers, `--tile` screenshot wells, `--fill`
  inputs/quiet controls, `--line`/`--line-strong` hairlines, `--ink` → `--ink-4` text (never use
  `--ink-4` for readable text), `--accent` (vermilion, UI graphics) and `--accent-text` (accent
  text), status `--positive` / `--caution` / `--critical` with `-soft` backgrounds.
- **Type:** Instrument Sans (`--font-sans`) for all UI. Newsreader (`.display` class or
  `--font-serif`) only for: home headline, teardown titles/pull quotes, About/legal/pricing
  page titles. Geist Mono (`.mono`) for versions, API paths, ranks. Use `.num` (tabular figures)
  for any column of numbers. Scale: `--text-2xs` 11 → `--text-5xl` 56; UI default 14px.
- **Space:** 4px grid (`--space-1` … `--space-24`). **Radius:** pills for controls
  (`--radius-pill`), `--radius-lg` (14) for tiles, `--radius-sm/md` for inputs/cards.
- **Elevation:** hairlines first. `--shadow-shot` on screenshots, `--shadow-float` only for
  things that float (dialogs, palette, menus).

## Layout
- `BaseLayout` (`src/layouts/BaseLayout.astro`) for every page: pass `title` (no brand),
  `description`, `canonical` when the URL has query params, `noindex` for thin/utility pages,
  `jsonLd` for schema.org.
- Content goes in `.container` (max 1440, responsive gutters) or `.container-narrow` (680px
  reading width) for long text.
- Vertical rhythm between blocks: `.page-block` (48px mobile / 64px desktop). Within a block:
  `<SectionHeader>` then content.
- **Grids** (use these, don't invent new ones): `.grid.grid--shots` (desktop captures, store
  cards: 1/2/3 cols), `.grid.grid--themes`, `.grid.grid--mobile-shots` (2/3/5),
  `.grid.grid--sections` (1/2/3/4).
- Tables: `.table-wrap > table.table`, numeric cells `.is-num`.
- Breakpoints: 480, 640, 768, 1024, 1280. Check every page at **390** and **1440**.

## Components
`src/components/ui/` — generic:
`Button` (primary = ink pill, secondary, quiet, ghost; sizes sm/md/lg; `href` makes it a link;
`external` + `rel="sponsored"` for affiliate), `Icon` (Phosphor; add names in `icons.ts`),
`Chip` + `ChipRow` (filters as links = URL state), `Segmented` (device toggle, view toggle),
`Tabs` (page-type tabs, underline), `Badge`, `Rating` (ink star, never yellow), `Stat` +
`StatList`, `SourceNote`, `Facts` (label/value sidebar), `PageHeader`, `SectionHeader`,
`Breadcrumbs`, `Pagination`, `EmptyState` (our own blank-tile art), `Skeleton`, `Notice`,
`Field` + `Input` (`as="textarea|select"`) + `Checkbox`, `Dialog` (native `<dialog>`, open with
`data-dialog-open="id"`), `Kbd`, `AppIcon`, `StoreMark`.

Signature elements (see direction.md): `MonoLabel` (■ mono spec label), `Count` (superscript
count), `IndexList` + `IndexRow` (numbered catalogue rows, cursor-following capture preview),
`Stat display` (serif numerals + mono label), utilities `.mlabel`, `.count-sup`, `.marks` (crop
marks), `.cols-12` + `.span-8`/`.start-9` (asymmetric composition), `.rule`. The footer ends with
`Wordmark` (SITE_NAME fitted to the full width). `PageHeader` takes `eyebrow` + `count`;
`SectionHeader` takes `label` + `count` + `rule`.

`src/components/media/` — screenshots:
- `Shot`: thumbnail tile (top of a full-page capture in a warm well, bleeding off the bottom).
  Pass the full capture `width/height`; it requests only the top slice.
- `SectionCrop`: a section slice contained in a fixed 4:3 well (desktop strips and mobile slices
  share one grid).
- `FullPage`: the full capture with a sticky sections rail and outlines. This is the core
  "depth" experience: use it on store pages, teardowns and section detail.

`src/components/domain/` — product objects: `StoreCard`, `ThemeCard` (deck of 3 stores),
`AppRow` + `AppTable` (dense ranked rows), `SectionCard`, `TeardownCard`, `AffiliateCta` (always
labels affiliate links under the button), `SaveButton` (Pro boards hook → sign-in for now).

`src/components/site/` — `Header` (search trigger dispatches `palette:open`; falls back to
`/search`), `Footer`, `Logo` (mark + `SITE_NAME`).

## Patterns
- **Index pages:** `PageHeader` → filter bar (chips/segmented, all URL params) with result count
  on the right → grid or table → `Pagination`. Empty result → `EmptyState` with a way out.
  Mobile: filters collapse into a single "Filters" button opening a `Dialog` (bottom-sheet
  style) with a sticky "Show N results" footer.
- **Detail pages:** breadcrumbs → two-column header (identity left; CTA/facts right) → facts strip
  (`StatList`, every stat with source) → primary visual block (screenshots) → secondary blocks
  (stores, apps, sections, similar) → source note.
- **Screenshots:** grid tiles link to the store page anchored at that page type/device. Device
  toggle = `Segmented` with desktop/device-mobile icons. Page-type switch = `Tabs`.
- **Affiliate:** links come from data (`/go/<id>`), rendered with `AffiliateCta` or a `Button`
  with `rel="sponsored"` and an adjacent "Affiliate link" label. Never inline affiliate URLs.
- **Brand:** import `SITE_NAME` from `~/config/site`; never type the brand name.

## Accessibility & performance
- Visible focus (`:focus-visible` ring is global). Icon-only buttons need `label`.
- Real `alt` on screenshots ("Store home page, desktop"). Decorative images `alt=""`.
- Images: always `width`/`height`, `loading="lazy"` except the first row (`eager`).
- Ship minimal JS: vanilla `<script>` in components; no UI framework.
- Respect `prefers-reduced-motion` (tokens collapse durations).
