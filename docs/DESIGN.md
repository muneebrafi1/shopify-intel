# Design system (v2, "product-grade SaaS")

The binding visual direction is [`design/direction.md`](design/direction.md) (owner-approved,
17 Nov 2026). This file is the **how**: tokens, theme mechanics, every shared component with its
props, and recipes for each kind of page. The living reference is **`/design-system`** (run
`npm run dev`, open it, flip the theme with its switch). If this file and a component's header
comment disagree, the component is right; fix this file.

## Principles

1. **The product UI is the hero visual.** Real captures, pinned section tags, real theme/app
   data. No stock art, mascots, abstract 3D, icon-in-a-circle triplets or fake logos.
2. **Quiet neutrals, one accent.** Vermilion is a signal, not paint: focus, the logo, selected
   tags, the recommended plan, the live dot, and the Pro CTA (`Button variant="accent"`).
   **Primary buttons are ink.**
3. **Hairlines first, then shadow.** 1px `--line` borders on everything; shadows are small. Dark
   cards and windows add the lit top edge (`--highlight`).
4. **Every number has a source and a date** (`Stat source asOf`, `SourceNote`, `FactsCard`,
   `Counter asOf`). Never invent metrics.
5. **Left-aligned.** Only the home hero and the pricing header are centred.
6. **Both themes, both widths.** Every page works in light and dark, at 390px and 1440px, with
   no horizontal overflow. Check with real screenshots (see "Checking your page").
7. **Copy is plain and short.** No "unlock", "supercharge", "seamless", "powerful", "AI-powered",
   exclamation marks. Brand only via `SITE_NAME`; legal entity only via `LEGAL_ENTITY`
   (`src/config/site.ts`).

## Tokens (`src/styles/tokens.css`)

All values are in direction.md; names you will use:

| Group    | Tokens                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces | `--bg` page · `--bg-subtle` alternating bands, footer · `--surface` cards, popovers, windows · `--surface-2` wells, inputs, quiet fills · `--surface-3` hover on surface-2 · `--raised` thumb                     |
| Lines    | `--line` hairlines, card borders · `--line-strong` inputs, hovered cards, wells in dark                                                                                                                           |
| Ink      | `--ink` headings · `--ink-2` body · `--ink-3` meta (AA) · `--ink-4` **disabled/decorative only**                                                                                                                  |
| Accent   | `--accent` graphics · `--accent-text` accent text (AA) · `--accent-soft` pills/rows · `--accent-wash` tinted areas · `--accent-btn`/`--accent-fg` text on an accent fill                                          |
| Buttons  | `--btn-bg`, `--btn-bg-hover`, `--btn-fg` (ink in light, near-white in dark), `--btn-fg-2` muted text on it                                                                                                        |
| Status   | `--positive`, `--caution`, `--critical` + `-soft` backgrounds                                                                                                                                                     |
| Depth    | `--shadow-xs/sm/md/lg`, `--highlight`, `--shadow-card` (xs + highlight), `--shadow-shot` (capture ring), `--overlay` (dialog backdrop)                                                                            |
| Type     | `--font-sans` (Instrument Sans), `--font-mono` (Geist Mono); sizes `--text-display-xl/lg/md`, `--text-h2/h3/h4`, `--text-lead`, `--text-body` 15, `--text-ui` 14, `--text-sm` 13, `--text-xs` 12, `--text-2xs` 11 |
| Space    | `--space-0-5` … `--space-32` (4px grid)                                                                                                                                                                           |
| Layout   | `--page-max` 1200, `--page-max-wide` 1440, `--reading-max` 680, `--page-gutter` 16/24/32, `--header-h` 56/64, `--section-y` 64→96, `--section-y-app` 32→48                                                        |
| Radius   | `--radius-control` 8, `--radius-well` 10, `--radius-card` 12, `--radius-band` 20, `--radius-pill` (also `--radius-xs/sm/md/lg/xl` = 4/6/8/12/20)                                                                  |
| Motion   | `--dur-fast` 120 (colour), `--dur-base` 180 (lift, indicator), `--dur-slow` 320 (reveal, sheet), `--ease-out`; all 0 under reduced motion                                                                         |
| Misc     | `--capture-bg` (captures are always light), `--spotlight`, `--selection`, `--header-bg`, `--focus-ring`                                                                                                           |

**v1 aliases (migrate away from them):** `--tile`, `--tile-hover`, `--fill`, `--fill-hover`,
`--fill-active` → surface-2/3; `--inverse`, `--inverse-2`, `--ink-inverse`, `--ink-inverse-2`,
`--line-inverse` → the `--btn-*` set; `--font-serif` → sans; `--shadow-float` (ring + md);
`--ph-*` (placeholder wireframe colours). Note the inverse set **flips in dark** (it is "the
opposite of the page"): an old `background: var(--inverse)` band is dark in light mode and light
in dark mode. For a band that is dark in both themes use `data-theme="dark"` (below).

Never use raw hex/rgb in components (exception: the capture well, which is `--capture-bg`).

## Themes

- **Light is the default.** Dark follows `prefers-color-scheme` until the visitor picks; the
  choice is stored in `localStorage['theme']` = `'light' | 'dark' | 'system'`.
- **Before paint:** an inline script in `BaseLayout`'s `<head>` resolves the preference and sets
  `<html data-theme="light|dark" data-theme-pref="…" class="js">` and the `theme-color` meta.
  No flash. Without JS the CSS media query applies.
- **After load:** `src/components/ui/client/theme.ts` (loaded by BaseLayout) handles every theme
  control by delegation, follows OS changes while on `system`, syncs other tabs, swaps tokens
  without transitions (`html.theme-switching`), and fires `theme:change` on `document`
  (`detail: { pref, theme }`). All `localStorage` access is in try/catch.
- **Subtrees:** any element with `data-theme="dark"` renders its subtree with the dark tokens
  (and `data-theme="light"` forces light). Use it for **dark bands inside a light page** (home
  "how it works", the Pro CTA band): `<section class="band section" data-theme="dark">`. Text
  colour follows automatically; set `background: var(--bg)` (or use `.band`). The full-page
  capture area uses `data-theme="light"` so tags read on light store pages in either theme.
- Don't style by theme in components (`[data-theme='dark'] .x`) unless a token can't express it;
  the only current cases are capture wells getting a `--line-strong` border in dark.

## Layout and rhythm (`src/styles/base.css`)

- `BaseLayout` props: `title` (no brand), `description`, `canonical`, `noindex`, `ogImage`,
  `jsonLd`, `chrome` (`full` | `minimal` | `none`), `bodyClass`, `navCounts`, `dataNote`,
  **`wide`** (gallery pages: aligns header/footer with the 1440 container).
- Containers: `.container` (1200 content), `.container--wide` (1440, galleries: stores, themes,
  sections), `.container--narrow` / `.container-narrow` (680 reading).
- `.guides` on a container: Stripe guide lines at the content edges (≥1024). Home, Pro, About.
- Rhythm: `.section` (marketing block: 64 → 96 padding), `.section--app` (32 → 48),
  `.section--subtle` (`--bg-subtle`), `.section--rule` (top hairline), `.band` (a radius-20
  surface; add `data-theme="dark"` for a dark band). v1 `.page-block` = app rhythm margin.
- Grids (use these): `.grid.grid--shots` (1/2/3), `.grid.grid--themes`, `.grid.grid--mobile-shots`
  (2/3/5), `.grid.grid--sections` (1/2/3/4), `.cols-12` + `.span-4/5/7/8`, `.start-8/9`.
- Tables: `.table-wrap > table.table` (14px, 48px rows, hairlines, row hover); modifiers
  `.table--sticky` (header sticks under the site header), `.table--dense` (13px/40px, admin),
  `.table--inset` (side padding, inside a card; also set `--table-head-bg: var(--surface)`).
  Numeric cells: `.is-num` (right, tabular).
- `.disclosure` on `<details>` (FAQ rows with a chevron). `.prose` for long text (pull quote =
  `blockquote`, 22/500 with a 2px accent rule).
- Utilities: `.stretched-link` (make a card's main link cover the card), `.visually-hidden`,
  `.bg-spotlight` (hero light), `.bg-grid` (faint masked grid behind a product window),
  `.fade-bottom` (crop a tall visual; `--fade` sets the fade length).

### Typography classes

| Class                       | Spec (desktop → 390)                    | Use                                     |
| --------------------------- | --------------------------------------- | --------------------------------------- |
| `.display-xl`               | 64/1.02, −0.04em, 600 (40)              | home hero only                          |
| `.display-lg`               | 48/1.05, −0.035em (34)                  | marketing titles (Pro, About)           |
| `.display-md`               | 36/1.1, −0.03em (28)                    | index and detail titles                 |
| `.h2` / `.h3` / `.h4`       | 28/1.15 (24) · 20/1.3 · 16/1.4 at 560   | section heads, card titles              |
| `.lead`                     | 18/1.55 (16), `--ink-2`                 | the line under a title                  |
| `.text-body`                | 15/1.6, `--ink-2`                       | paragraphs (body default is 14 UI text) |
| `.eyebrow` (= v1 `.mlabel`) | mono 12, uppercase, 0.06em, `--ink-3`   | labels above titles, column heads       |
| `.tone-muted`               | `--ink-3`                               | the muted half of a two-tone heading    |
| `.num` / `.mono`            | tabular figures / Geist Mono            | numbers in columns / versions, domains  |
| `.display` (v1)             | sans 600, −0.03em; size set by the page | migrate to `.display-*`                 |

Two-tone heading (once per section, max):
`<h1 class="display-xl">Ink sentence. <span class="tone-muted">Muted continuation.</span></h1>`.

## Motion

Quick and optional; every duration is 0 under `prefers-reduced-motion`.

- Buttons: colour 120ms, trailing arrows nudge 2px on hover, `:active` scale .98.
- Interactive cards: border → `--line-strong`, `--shadow-md`, `translateY(-2px)`, media img 1.015.
- Tabs/Segmented: one sliding indicator (`client/indicator.ts`; static fallback without JS).
- Header: transparent at the top; `[data-scrolled]` adds `--header-bg` + blur + hairline.
- `.reveal` (home and Pro only): fades and rises 8px once in view. Only hides content under
  `html.js`, and a 3s safety net un-hides it if the module never runs. Stagger siblings with
  `style="--reveal-delay: 80ms"`.
- `.spotlight` (home feature cards only): cursor-following radial light (`--mx/--my`).
- Shared JS lives in `src/components/ui/client/*.ts` and is loaded once per page (BaseLayout,
  Tabs/Segmented). Keep page scripts small; no UI frameworks.

## Components

Import paths: `~/components/ui/X.astro`, `~/components/media/X.astro`,
`~/components/domain/X.astro`, `~/components/site/X.astro`. Every component accepts `class`.

### Primitives (`ui/`)

- **Button** — `variant`: `primary` (ink) | `secondary` (surface + border) | `ghost` | `accent`
  (vermilion; **Pro CTAs only**) | `link` | `quiet` (v1); `size`: `sm` 30 | `md` 36 | `lg` 44;
  `href` → `<a>`; `icon` (leading), `iconRight` (trailing), `arrow` (trailing arrow that nudges);
  `label` (icon-only, required for a11y); `full`; `external` (new tab + noopener); `rel`
  (`"sponsored"` for affiliate); plus any `<button>` attribute and `data-*`.
  `<Button variant="primary" href="/stores" arrow>Browse stores</Button>`
- **Badge** — `tone`: neutral | outline | accent | positive | caution | critical | inverse;
  `size`: md 22 | sm 18; `dot` (status dot); `mono`; `icon`; `title`.
  `<Badge tone="positive" dot>Captured</Badge>`
- **AnnouncementPill** — `href`, `badge` ('New'; '' to hide); slot = text (≤ 48 chars).
  `<AnnouncementPill href="/teardowns/youngla">Teardown: how YoungLA sells</AnnouncementPill>`
- **Kbd** — slot. `<Kbd>⌘</Kbd><Kbd>K</Kbd>`
- **Card** — `href` (whole card is a link) | `interactive` (lift; use `.stretched-link` on the
  main link when the card has several links); `padding`: none | sm 16 | md 20 | lg 24→32;
  `as` (div/article/section/li/aside); `spotlight`; `dashed`; `accent` (accent ring: the
  recommended plan only); `mediaRatio`; `style`, `id`,
  `data-*`. Slots: `media` (surface-2 well on top), default (body), `footer` (hairline row).
  `<Card href="/themes/dawn" padding="none"><Shot slot="media" … flush />…</Card>`
- **Window** — product frame: `url` (mono pill) or `title`; `padded`; `fade` (fade the bottom);
  `height` (fixed, clipped); `bodyClass`. Slots: default (body, `--surface-2`), `toolbar`
  (right side of the bar). Neutral dots only, never traffic-light colours.
- **Tabs** — `items: { label, href, selected?, count? }[]`, `label` (nav name), `size` sm|md.
  Links + `aria-current="page"`; sliding 2px ink indicator.
- **Segmented** — `items: { label, value, href?, icon?, selected?, iconOnly?, count? }[]`,
  `label`, `size` sm 30 | md 36, `full`, `name`. With `href`: links + `aria-current="true"`
  (URL state, preferred). Without: buttons + `aria-pressed`; a click selects and dispatches
  `segmented:change` (`detail: { name, value }`). Pages may flip `aria-current` in place; the
  thumb follows. Class contract: `.seg`, `.seg__item`.
- **ThemeToggle** — header icon button (sun/moon crossfade), `aria-pressed` = dark. No props.
- **ThemeSwitch** — System / Light / Dark radiogroup. `labels` (show text), `size` sm|md.
  Footer and mobile menu use it; a settings page can too.
- **BrowseBar** — the index-page bar. Props: `groups: FilterGroup[]` (`{ key, label, options:
{ label, href, selected?, count? }[] }`), `total`, `noun`, `sort?: { label, href, selected? }[]`,
  `view?: { current: 'grid' | 'index', gridHref, indexHref }`, `clearHref?`,
  `search?: { action?, name? ('q'), value?, placeholder?, hidden?: Record<string, string> }`,
  `pills?` (key of the group shown as inline scrolling pills; the others become dropdowns ≥1024),
  `sticky` (default true: sticks under the header, full-bleed background + hairline once stuck).
  All state is URL state (links + a GET form). <1024: search, pill row, then [Filters] · count ·
  view; the "Filters" bottom sheet (`#filter-sheet`) has every group plus sort. One per page.
  Class contract used by e2e: `.fbar`, `.fbar__total`, `.fbar__active` (removable chips),
  `#filter-sheet`, a "Filters" button. **`FilterBar` is the v1 name**: same props, renders
  BrowseBar.
- **Chip** / **ChipRow** — filter pill (link by default): `href`, `selected` (ink fill),
  `count`, `icon`, `removable`, `size` sm|md, `data-*`. ChipRow: `label`, `wrap` (otherwise
  scrolls sideways below 1024).
- **PageHeader** — `title`, `titleMuted` (two-tone), `description` (v1: `lede`), `eyebrow`,
  `count` (mono number after the title), `size` md (display-md) | lg (display-lg), `align`
  start | center. Slots: `top` (breadcrumbs), `meta`, `actions` (right ≥1024), default.
  Renders the page's one `<h1>`.
- **SectionHeader** — `title`, `titleMuted`, `description`, `eyebrow` (v1: `label`), `href` +
  `linkLabel` ("View all" →), `count`, `level` 2|3, `size` md (h2) | lg (display-md, marketing),
  `align`, `rule` (hairline above), `id`. Default slot: controls next to the link.
- **Facts** — key/value rows: `items: { label, value, href?, mono?, title? }[]`, `ruled`.
  Default slot: extra `<div class="facts__row"><dt/><dd/></div>` rows.
- **FactsCard** — detail-page side panel: `title`, `items`, `source`, `asOf`, `sourceHref`
  ('/methodology'; '' hides "Method"), `sticky` (sticks under the header ≥1024). Slots: default
  (extra rows), `actions` (buttons/AffiliateCta under the rows), `footer`.
- **Stat** / **StatList** — `value`, `label`, `source`, `asOf`, `size` sm|md|lg, `display` (big
  marketing numerals + mono label). Must sit in `StatList` (a `<dl>`): `columns`, `boxed`
  (hairline cells in a card, Stripe-style).
- **Counter** — live mono line with the accent dot: `items: { value, label }[]`, `asOf`,
  `asOfLabel` ('data'), `live` (pulse). Home hero, Pro header.
- **SourceNote** — `source`, `asOf`, `href` ('/methodology'; '' hides the link).
- **EmptyState** — dashed card: `title`, `body`, `icon` (20px line icon, no circle), `align`
  start | center, `size` sm|md, `level`. Default slot: one action.
- **StoreMark** — store avatar: rounded square in the store's tone with its initial. `domain`,
  `name` (initial), `size` (32). **AppIcon** — `src`, `name`, `size` (monogram fallback).
- **Icon** — `name` (see `icons.ts`; Phosphor regular, `-fill` for rating/saved, `-bold` for
  pricing checks), `size` (16 UI, 20 feature cards), `label` (only when meaningful). Add icons
  by importing the SVG in `icons.ts`. One icon set only.
- Also restyled, same API as v1: **Breadcrumbs** (`items`), **Pagination** (`page`, `pageSize`,
  `total`, `hrefFor`, `noun`), **Rating**, **Notice** (`tone` info|caution|positive|critical,
  `title`, `icon`), **Field** + **Input** (`as="textarea"|"select"`) + **Checkbox**, **Dialog**
  (`id`, `title`, `hideTitle`, `size`; open with `data-dialog-open="id"`), **Skeleton**,
  **IndexList** + **IndexRow** (dense list view; new `numbering` prop: `'rank'` | `'none'` |
  `'specimen'` — default stays `'specimen'` ("N°001") only because stores/themes e2e assert it;
  new pages pass `'rank'`), **Count**, **MonoLabel** (= `.eyebrow`; `tone` ink|muted).

### Media (`media/`)

- **Shot** — capture thumbnail: top of a full-page capture inset in a `--surface-2` well
  (radius 10, inset hairline; `--line-strong` in dark). `src`, `width`, `height` (full capture),
  `device`, `alt`, `href?`, `eager`, `ratio` (4/3 desktop, 4/5 mobile), `tag` (mono label),
  `flush` (no radius/border: when it is a Card's media).
- **SectionCrop** — one sliced section in a fixed-aspect well: `src`, `width`, `height`,
  `device`, `alt`, `href?`, `ratio`, `eager`.
- **FullPage** — the signature viewer: capture in a well with **pinned section tags** (ink pill,
  mono 11, "02 Reviews · Loox") on every section, dashed outlines, accent on hover/current, a
  sticky rail (list ≥1024, pill row below). Props: `src`, `width`, `height`, `device`, `alt`,
  `sections: { id, type, name, y, height, x?, w?, app?, href? }[]`, `rail`, `eager`,
  `tags` ('pinned' | 'hover'), `bare` (no well: inside a `Window`). Class contract: `.fp__item`
  `[data-target]`, `.fp__region[data-region]`, `.fp__tag`, `.fp__canvas > img`, `fp--mobile`.

### Product cards (`domain/`)

- **StoreCard** — `domain`, `name`, `href`, `shot`, `meta` (defaults to the domain), `tag`,
  `badges: { label, tone? }[]`, `eager`; slot `aside`. (`n` is ignored.) One link per card.
- **ThemeCard** — `slug`, `name`, `vendor`, `priceLabel` (Free → positive badge), `storesCount`,
  `shots` (deck of up to 3 desktops, or a desktop + phone pair), `href`, `eager`.
- **SectionCard** — `href`, `crop`, `device`, `typeName`, `storeLabel`, `meta`, `app`, `eager`.
- **TeardownCard** — `slug`, `title`, `dek`, `storeLabel`, `publishedAt`, `shot`, `size` md|lg,
  `isSample`.
- **AppRow** + **AppTable** — dense ranked rows (rank, icon, name + BFS badge, developer ·
  category, rating, price, stores + share). AppTable: `ranked`, `usageLabel`.
- **AffiliateCta** — `href` (`/go/<id>` from data), `label`, `isAffiliate`, `size`, `full`.
  Always labels affiliate links under the button.
- **SaveButton** — `itemType`, `itemId`, `size`, `iconOnly` (→ sign-in until accounts exist).

### Site chrome (`site/`)

- **Header** (via BaseLayout) — nav from `PRIMARY_NAV` (Stores, Themes, Apps, Sections,
  Teardowns, Compare), search trigger (`[data-palette-open]`, ⌘K), ThemeToggle, Sign in, Get
  Pro; mobile sheet (`dialog[data-menu]`) with nav counts (`navCounts`), secondary links, the
  ThemeSwitch and the CTAs. `minimal` shows the logo + toggle.
- **Footer** — Explore · Compare · Product · Company · Legal; ThemeSwitch; "© year
  `LEGAL_ENTITY`", the data note, "Not affiliated with Shopify Inc."
- **Logo** (`wordmark`, `size`), **CommandPalette** (opens on ⌘K, "/", or `palette:open`),
  **PreviewNotice**, **Wordmark** (unused in v2 chrome).

## Page recipes

Use these combinations; don't invent new primitives per page. If something is missing, add it
to the shared components (and to `/design-system`) rather than styling it locally.

- **Index page** (stores, themes, apps, categories, sections, teardowns, compare, alternatives):
  `BaseLayout wide` (galleries) → `.container--wide` → `PageHeader` (eyebrow, display-md title,
  one-line `description`, `count`; breadcrumbs in `top` for nested indexes) → `BrowseBar`
  (`search`, `pills` = the main category group, `sort`, `view`) → `.grid.grid--shots` of
  `StoreCard`/`ThemeCard`/`SectionCard`, or a `table.table` / `AppTable` when data is the point
  → `Pagination` or a "Load more" `Button`. Empty → `EmptyState` with one way out.
- **Detail page** (store, theme, app, section type, compare pair, teardown): `Breadcrumbs` →
  identity row (`StoreMark`/`AppIcon`, name as `.display-md` h1, domain in `.mono`, `Badge`s;
  actions right: `Button iconRight="arrow-up-right" external` "Visit", `SaveButton`, Compare)
  → `Tabs` → two columns at ≥1024 (`minmax(0,1fr) 320px`): main column + `FactsCard sticky`
  → related grids under `SectionHeader href`. Store detail centrepiece: `FullPage` with page
  `Tabs` and a Desktop/Mobile `Segmented`, optionally inside a `Window`.
- **Marketing page** (home, Pro, About): `.guides` container, `.section` rhythm, centred hero
  only on home (`AnnouncementPill` → `.display-xl` two-tone h1 → `.lead` → primary + secondary
  `Button`s → `Counter`), product visuals in `Window` (+ `.bg-grid`, `.fade-bottom`),
  `SectionHeader size="lg"`, feature `Card`s with real UI in the `media` slot (`spotlight` on
  home), dark bands via `data-theme="dark"`, `.reveal` on blocks.
- **Pricing** (`/pro`): centred `PageHeader size="lg" align="center"` with two-tone title →
  `Segmented` Monthly/Yearly (links, URL state) → plan `Card padding="lg"`s (recommended:
  `Card accent` + `Button variant="accent"`) → comparison
  `table.table.table--sticky` grouped by `.eyebrow` rows, `Icon name="check-bold"` → FAQ as
  `.disclosure` → lifetime note. At 390 show one plan column at a time with a `Segmented`.
- **Reading page** (teardown, methodology, legal, developers): `.container--narrow`,
  `.display-lg` title, `.lead` dek, byline in `.text-sm .muted`, `.prose` body, sticky TOC at
  ≥1200 (see `/design-system`'s "On this page" pattern), `SourceNote` at the end.
- **Account / sign-in**: a centred `Card padding="lg"` (max ~420px) on a `.section--subtle`.
- **Admin**: same tokens and both themes; 232px sidebar, top bar with breadcrumb, `table.table
.table--dense`, metrics in `StatList boxed`, `Badge size="sm"` for status.

## Do / don't

- **Do** use tokens and the classes above; **don't** hard-code colours, radii or shadows.
- **Do** make primary actions ink (`primary`); **don't** use `accent` outside Pro CTAs.
- **Do** put real UI in feature cards; **don't** use icon-in-a-circle triplets, emoji,
  gradients as decoration, glass cards, purple glows or gradient text.
- **Do** left-align; **don't** centre sections (home hero and pricing header only).
- **Do** use `data-theme="dark"` for dark bands; **don't** build "inverse" bands by remapping
  tokens locally (the v1 bands in ThemePlates, SeenOn and the category stage do this; replace
  them when you redesign those pages).
- **Do** keep one `<h1>` (PageHeader renders it), real `alt` text, `width`/`height` on images,
  `loading="lazy"` except the first row.
- **Do** use URL state for filters/sort/view/tabs (links); **don't** require JS to filter.
- **Don't** use `--ink-4` for readable text; **don't** set text on `--accent` (use
  `--accent-btn` + `--accent-fg`).
- **Don't** reintroduce v1 specimen visuals: N° numbers, crop marks (`.marks` is a no-op now),
  serif type, square-bullet labels.

## Checking your page

- `npm run screens -- --base http://127.0.0.1:4321 /your/page` (light) and
  `npm run screens -- --theme dark /your/page` → `.data/screenshots/<slug>--<width>[--dark].jpg`
  at 390 and 1440. Look at all four.
- `npm run test:e2e` covers health (one h1, no overflow, named controls, no console errors) at
  both widths; `tests/e2e/theme.spec.ts` covers the theme mechanics.
- Accessibility: visible focus is global (`:focus-visible` = 2px accent outline); icon-only
  buttons need `label`; `--ink-3` is the lightest colour for readable text.
- Budgets (`npm run size`): largest CSS chunk ≤ 20 KB gz, total client CSS ≤ 90 KB, client JS
  ≤ 60 KB total / 25 KB largest.
