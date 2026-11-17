# Visual direction v2 — "product-grade SaaS"

_Replaces the v1 "specimen archive" direction (17 Nov 2026, owner decision). Binding for every
page. If something here conflicts with older docs or component comments, this file wins._

## Goal in one line

The site should feel like a 2026 SaaS product at Linear / Attio / Vercel / Stripe polish. It
should also be honest and data-dense in the way only this product can be: **the product UI is
the hero visual.** We never use stock art, mascots or abstract 3D. We show real store captures,
section tags, theme and app data.

## Approved references (Mobbin, 17 Nov 2026)

| Site                              | What we take                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear (linear.app)               | **Dark theme.** Near-black surfaces, 1px hairlines, soft light instead of colour glows. Left-aligned headline with a big product window under it, cropped by the fold. Feature cards that each hold a small piece of **real UI**, not an icon. |
| Attio (attio.com)                 | **Light theme.** Centred hero with a small "New" pill above the headline. Dark primary and outline secondary buttons. Product window rising out of a faint grid. Nav: logo, a few links, "Sign in", one solid button.                          |
| Stripe (stripe.com)               | Faint vertical guide lines framing the content column. **Two-tone headline** (ink sentence, then a muted continuation). Live counter above or under the headline. Logo strip in hairline cells.                                                |
| Vercel (vercel.com/pricing)       | Pricing **comparison table**: the header row with plan name and CTA stays visible, rows are grouped under mono eyebrows, each feature has a one-line explanation, solid check marks.                                                           |
| Cloudflare (cloudflare.com/plans) | **Plan cards** row above the table. The recommended plan gets an accent border and a filled button. "Compare all features" uses collapsible groups, which stack well at 390px.                                                                 |
| Dovetail (dovetail.com)           | A step list on the left drives a product visual on the right (the active step expands). We use it for "how it works": capture → slice → tag → compare.                                                                                         |
| Base44 (base44.com)               | **Browse pattern** for index pages: one bar with search, category pills and a sort menu, then cards on a hairline grid with screenshot, title, meta and a price badge.                                                                         |
| Twenty (twenty.com)               | Real product crops with **labels pinned on them**. For us that means section-type tags ("Hero", "Product grid", "Reviews") pinned onto captures, which is the product's core differentiator.                                                   |

Never: purple or rainbow glows, gradient text, frosted-glass cards, mascots or illustrations,
emoji, icon-in-a-circle triplets, fake logos or testimonials, invented metrics, "Unlock the power
of…" copy, or every section centred. Only the home hero and the pricing header are centred;
everything else is left-aligned.

## Themes

- **Light is the default.** Dark follows `prefers-color-scheme`, and a toggle overrides it.
  The choice is stored in `localStorage['theme']` as `'light' | 'dark' | 'system'`.
- `<html data-theme="light|dark">` is set by a tiny inline script in `<head>` before first
  paint, so there is no flash. The CSS works without JS through the media query.
- Tokens live in `src/styles/tokens.css`. The dark set is applied by `:root[data-theme='dark']`,
  by `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`, and by **any
  subtree** carrying `data-theme="dark"`. That last one is used for dark bands inside a light
  page (home "how it works", the Pro CTA band).
- `color-scheme` is set to match, so form controls and scrollbars follow the theme.
- The header has an icon toggle (sun/moon) that flips the effective theme. The footer has a
  3-way segmented control (System / Light / Dark).
- Captures are always light store pages. In dark mode they sit in a `--surface-2` well with a
  `--line-strong` border, so they don't glare.

## Tokens

### Colour (light → dark)

| Token            | Light     | Dark                   | Use                                                     |
| ---------------- | --------- | ---------------------- | ------------------------------------------------------- |
| `--bg`           | `#ffffff` | `#0a0a0b`              | page                                                    |
| `--bg-subtle`    | `#fafaf9` | `#0e0e10`              | alternating bands, footer                               |
| `--surface`      | `#ffffff` | `#131315`              | cards, popovers, windows                                |
| `--surface-2`    | `#f5f5f4` | `#18181b`              | screenshot wells, input fill, quiet buttons             |
| `--surface-3`    | `#eeeeec` | `#202024`              | hover/pressed on surface-2                              |
| `--line`         | `#ebebe9` | `rgb(255 255 255/.07)` | hairlines, card borders                                 |
| `--line-strong`  | `#dcdcd9` | `rgb(255 255 255/.12)` | inputs, hovered card borders                            |
| `--ink`          | `#121211` | `#f2f2f0`              | headings, primary text                                  |
| `--ink-2`        | `#4b4b48` | `#b3b3ae`              | body, secondary text                                    |
| `--ink-3`        | `#6b6b67` | `#8d8d88`              | meta, captions (AA on bg and surface-2)                 |
| `--ink-4`        | `#a6a6a1` | `#5b5b58`              | disabled and decorative only                            |
| `--accent`       | `#e4572e` | `#ff6b3d`              | vermilion: logo, focus, selected tags, recommended plan |
| `--accent-hover` | `#d64b22` | `#ff815a`              |                                                         |
| `--accent-text`  | `#c23e17` | `#ff8f6b`              | accent-coloured text (AA)                               |
| `--accent-soft`  | `#fdece5` | `rgb(255 107 61/.14)`  | accent pills, selected rows                             |
| `--btn-bg`       | `#121211` | `#f2f2f0`              | primary button (ink in light, near-white in dark)       |
| `--btn-fg`       | `#ffffff` | `#0a0a0b`              |                                                         |

Status colours (`--positive`, `--caution`, `--critical` plus `-soft`) get a dark variant each.
Keep the v1 names as aliases while pages migrate: `--tile` → `--surface-2`, `--fill` →
`--surface-2`, `--fill-hover` → `--surface-3`, `--inverse` → `--btn-bg`, `--ink-inverse` →
`--btn-fg`.

**The accent is a signal, not paint.** Primary buttons are ink, not vermilion. Vermilion fills
only appear on the Pro CTA (`Button variant="accent"`), the recommended plan, and the live dot.

### Type

- One family for everything: **Instrument Sans Variable** (`--font-sans`). Display sizes use
  weight 600 and tight tracking. Newsreader is removed (no serif anywhere). **Geist Mono**
  (`--font-mono`) is for eyebrows, versions, domains, API paths and numbers in tables.
- Scale (desktop / 390px):
  - `display-xl` 64/1.02, −0.04em (40) — home hero only
  - `display-lg` 48/1.05, −0.035em (34) — marketing page titles (Pro, About)
  - `display-md` 36/1.1, −0.03em (28) — index and detail page titles
  - `h2` 28/1.15, −0.025em (24)
  - `h3` 20/1.3, −0.015em
  - `h4` 16/1.4 at 560
  - `lead` 18/1.55 (16), `--ink-2`
  - `body` 15/1.6
  - `ui` 14/1.45
  - `sm` 13, `xs` 12
  - `eyebrow`: mono 12px, uppercase, 0.06em, `--ink-3`
- **Two-tone headings:** `<h1>Ink sentence. <span class="tone-muted">Muted continuation.</span></h1>`.
  Use on the home hero, the Pro header and big section heads. Use it at most once per section.
- Numbers in columns: `.num` (tabular figures).

### Space, layout, radius

- 4px grid (`--space-*` stays).
- `--page-max: 1200px` for marketing and reading pages. `--page-max-wide: 1440px` for galleries
  (stores, sections, themes).
- Gutters are 16 / 24 / 32 at <640 / ≥640 / ≥1024.
- Section rhythm: marketing blocks 96px (390: 64), app pages 48px (390: 32).
- Radius:
  - controls 8px
  - cards and windows 12px
  - screenshot wells 10px
  - big bands 20px
  - chips, badges and pills 999px
- Stripe guide lines: `.guides` on a container draws 1px `--line` verticals at the content edges
  (≥1024 only). Use it on home, Pro and About.

### Depth

Use hairlines first, then shadow.

- **Light:**
  - `--shadow-xs` = `0 1px 2px rgb(18 18 17/.05)`
  - `--shadow-sm` = `0 1px 2px rgb(18 18 17/.04), 0 4px 12px -4px rgb(18 18 17/.08)`
  - `--shadow-md` = `0 2px 4px rgb(18 18 17/.04), 0 12px 32px -12px rgb(18 18 17/.18)` (hovered cards, windows)
  - `--shadow-lg` = `0 24px 64px -16px rgb(18 18 17/.28)` (dialogs, palette)
- **Dark:** the same shadows with black at higher alpha, plus `--highlight: inset 0 1px 0 rgb(255 255 255/.05)`
  on cards and windows (the lit top edge Linear uses).
- **Gradients** are allowed only as light, never as colour decoration:
  - the hero spotlight (radial, `--ink` at 4–6%)
  - a faint grid behind the hero window, masked to fade out
  - a vermilion bloom at ≤10% under the hero product window in dark mode only
  - the Pro band edge

## Motion

All motion is quick, physical and optional. Under `prefers-reduced-motion` every duration goes
to 0.

- Durations: `--dur-fast` 120ms (colour and background), `--dur-base` 180ms (lift, border),
  `--dur-slow` 320ms (reveals, sheets). Easing: `--ease-out: cubic-bezier(.2,.8,.2,1)`.
- **Buttons:** background and colour 120ms; a trailing arrow nudges 2px on hover; `:active`
  scales to .98.
- **Interactive cards:** border → `--line-strong`, `--shadow-md`, `translateY(-2px)`, image
  inside scales 1.015.
- **Tabs and segmented controls:** a sliding indicator (CSS custom properties set from JS, with
  a static fallback).
- **Header:** transparent at the top; a hairline and background blur appear once the page has
  scrolled (`[data-scrolled]`).
- **Reveal on scroll:** home and Pro only. `.reveal` fades and moves 8px over 320ms, once, via
  IntersectionObserver. It only activates when `html.js` is set, so content is never hidden
  without JS.
- **Cursor spotlight:** home feature cards only. A radial highlight follows the cursor through
  `--mx/--my`.
- **Viewer:** hovering a section row outlines that section on the capture, and clicking
  scrolls to it smoothly.

## Components

| Component                  | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header                     | 64px (56 on mobile), sticky, `color-mix(in srgb, var(--bg) 80%, transparent)` + `backdrop-filter: blur(12px)` once scrolled. Left: logo mark + `SITE_NAME`. Nav: Stores, Themes, Apps, Sections, Teardowns, Compare (14px `--ink-2`; hover shows a `--surface-2` pill; current page is `--ink` with `aria-current`). Right: search trigger that looks like an input with a ⌘K kbd (icon-only <1200), theme toggle, "Sign in" (ghost), "Get Pro" (primary). Below 1024: logo, search, menu button → full-height sheet with nav, counts, theme switch and the Pro CTA. |
| Footer                     | `--bg-subtle`, top hairline. Logo + one-line description + theme segmented control. Columns: Explore, Compare, Product, Company, Legal (mono uppercase heads). Bottom row: "© 2026 Xovist", data date note, "Not affiliated with Shopify Inc."                                                                                                                                                                                                                                                                                                                       |
| Button                     | Sizes sm 30, md 36, lg 44 (≥44 hit area on touch). Variants: `primary` (`--btn-bg`), `secondary` (surface + `--line-strong` border + `--shadow-xs`), `ghost`, `accent` (vermilion; Pro CTAs only), `link`. Optional leading or trailing Phosphor icon.                                                                                                                                                                                                                                                                                                               |
| Badge / Pill               | 22px, pill radius, 12px/520. Variants: `neutral` (surface-2), `outline`, `accent` (accent-soft + accent-text), `positive`, `caution`. The announcement pill pairs a `New` badge, text and an arrow.                                                                                                                                                                                                                                                                                                                                                                  |
| Kbd                        | Mono 11px, 1px `--line-strong`, radius 4, `--surface`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Card                       | `--surface`, 1px `--line`, radius 12, `--shadow-xs` (+ `--highlight` in dark). Variants: `static` and `interactive` (hover lift as in Motion). Optional `--surface-2` media well on top with an inset hairline.                                                                                                                                                                                                                                                                                                                                                      |
| Window (product frame)     | Radius 12, `--line-strong` border, `--shadow-md`. 36px top bar with three neutral dots (`--ink-4` at 50%, **never** red/yellow/green) and a mono URL pill showing the store domain. Body is `--surface-2`.                                                                                                                                                                                                                                                                                                                                                           |
| Section tag (pinned label) | The Twenty pattern. A label pill (ink background, `--btn-fg`, mono 11px) pinned at the top-left of a section's rectangle on a capture. The section outline is 1.5px: `--accent` when active or hovered, dashed `--line-strong` otherwise.                                                                                                                                                                                                                                                                                                                            |
| Browse bar                 | Sticky below the header on index pages: search input with icon, scrollable filter pills (selected = ink fill), sort select, optional grid/list toggle. One row ≥1024; on 390 it is search on top and a horizontally scrolling pill row under it.                                                                                                                                                                                                                                                                                                                     |
| Tabs                       | Underline style for page sub-views, sliding 2px `--ink` indicator. Segmented style (pill track on surface-2) for small 2–3-way switches (Desktop/Mobile, Monthly/Yearly, System/Light/Dark).                                                                                                                                                                                                                                                                                                                                                                         |
| Facts card                 | Side-panel key/value rows: label `--ink-3` 13px, value 14px `--ink` (mono for versions and dates), hairline separators, a source + date footnote.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Table                      | 14px rows of 48px, hairline separators, sticky header on `--bg`, numbers right-aligned in tabular figures, row hover `--surface-2`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Empty state                | Left-aligned in a dashed-border card: what's missing, why, and one action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Icons                      | Phosphor (`@phosphor-icons/core`) regular, 16px in UI and 20px in feature cards, `currentColor`. One icon set only.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Page patterns

1. **Home** (light by default):
   - **Hero** (Attio + Stripe), centred:
     - announcement pill linking the newest teardown
     - two-tone H1 using the **existing headline** ("Shopify themes and apps, on the stores that run them.") until the brand is chosen
     - lead line
     - `Browse stores` (primary) and `Search ⌘K` (secondary)
     - a live mono counter: stores scanned, sections tagged, scan date
   - **Product window** under the hero, 1120px wide: the store viewer with a page-type sidebar, a full-page capture with pinned section tags, and a sections list. At 390px it is the capture plus 3 tags, cropped with a bottom fade.
   - **Curated store strip** in hairline cells (Stripe).
   - **"How it works"** in a dark band (Dovetail): steps on the left, a visual on the right.
   - **Feature bento** (Linear), with real UI fragments: themes, apps ranking, sections grid, compare, teardowns.
   - **Latest captures** gallery.
   - **Pro band.**
2. **Index pages** (stores, themes, apps, categories, sections, teardowns, compare, alternatives) use the Base44 pattern:
   - page header: eyebrow, `display-md` title, one-line description, total count
   - the browse bar
   - a card grid (or table where data is the point, e.g. the full stores index and app rankings)
   - pagination
3. **Detail pages** (store, theme, app, section type, compare pair, teardown) feel like an app view:
   - breadcrumb
   - identity row (mark or icon, name, domain or link, chips) with actions on the right (Visit ↗, Save, Compare)
   - tabs
   - a main column with a sticky facts card on the right at ≥1024
   - related grids
   - **Store detail centrepiece:** the viewer (page-type tabs, Desktop/Mobile segmented, full-page capture with pinned tags, sections rail).
4. **Pricing (/pro)**:
   - centred header (two-tone `display-lg`)
   - Monthly / Yearly segmented ("2 months free")
   - three plan cards (Cloudflare); Pro is recommended
   - a "Compare all features" table (Vercel) with the plan header row sticky. On 390px a plan switcher shows one plan column at a time.
   - FAQ accordion
   - lifetime-deal note
5. **Reading pages** (teardown, about, methodology, legal, developers):
   - 680px column
   - `display-lg` title, dek, byline "Editorial team · date"
   - sticky table of contents at ≥1200
   - sans throughout; pull quotes are 22px/500 with a 2px accent rule
6. **Account and sign-in:** a centred card on `--bg-subtle`, as in app auth screens.
7. **Admin:** an app shell with a 232px sidebar (sections with counts), a top bar with breadcrumb and user menu, dense 13px tables, cards for metrics, and the same tokens and both themes.

## Copy

Plain, specific and short. Numbers carry a source and a date. Avoid: "unlock", "supercharge",
"seamless", "powerful", "revolutionise", "AI-powered", exclamation marks. Never hard-code the
brand; use `SITE_NAME`.
