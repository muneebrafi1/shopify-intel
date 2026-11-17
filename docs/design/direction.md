# Design direction — "a specimen archive of live storefronts"

This is the binding visual direction for every page. `docs/DESIGN.md` covers tokens and
components; this file covers the **idea**, the **signature elements** and the **per-page intent**.
It comes from a Mobbin study of the best current (2025–26) sites, listed at the bottom.

## The idea

We are a catalogue of real Shopify storefronts. Each store, theme and app is a **specimen**:
numbered, captured, described with a precise spec sheet, and shown at full size. The tone sits
between a design archive (Are.na, Studio Freight), a museum catalogue (Waka Waka, SSENSE
editorial) and a technical data sheet (FREITAG, Spade). Calm, exact, slightly literary. Images
are the loud part. Type and data do the rest.

What we are **not**: a SaaS landing page. No pill badge above a centred hero, no gradient text,
no glass, no bento boxes, no icon-in-circle feature grids, no testimonial carousels, no
three-card "features", no stock illustrations, no emoji, no "Unlock/Supercharge/Elevate".
Those patterns are what "AI-made" looks like in 2026.

## Signature elements (use them consistently — they are the brand until there is a brand)

1. **Specimen numbers.** Stores, themes and apps carry an index number in mono, zero-padded:
   `N°014`. Used in index rows, detail headers ("N°014 — Store") and captions. Numbers come from
   rank/order in the current list (they are labels, not IDs).
2. **Spec labels.** Small mono uppercase labels with a square bullet for metadata and section
   markers: `■ DETECTED 17 NOV 2026`, `■ THEME`, `■ 11 APPS`. Component: `<MonoLabel>`.
   Spec rows (label left in mono, value right in sans) replace generic key/value cards.
3. **Superscript counts.** Counts sit as small mono superscripts after a title or nav item:
   `Themes²⁰`, `Stores⁹³⁰`. Component: `<Count>` (or the `count` prop on headers).
4. **Crop marks.** Corner registration ticks around hero visuals, the full-page viewer stage and
   stat blocks — a capture/print reference that fits "screenshots as plates". Utility: `.marks`.
5. **Contact-sheet captions.** Under every capture: identity in sans (domain or name), facts in
   mono (`PRESTIGE 9.3.0 · 11 APPS`), optional frame number `01/08` for sequences.
6. **Grid ↔ Index.** Every collection page offers a visual grid AND a numbered index view
   (Waka Waka-style rows with columns). On desktop, hovering an index row floats a live preview
   of that store's capture next to the cursor. Component: `<IndexList>` / `<IndexRow>`.
7. **One dark moment per key page.** A near-black band (`--inverse`) used once, on purpose: the
   home "wall" of captures, the compare verdict-free "side by side" stage, the footer wordmark.
   Never as a default card style.
8. **The wordmark sign-off.** Every public page ends with `SITE_NAME` set enormous in Newsreader
   across the full width (Structured / MOUTHWASH / BAGGU). It scales to any brand length.
9. **Editorial voice for statements and numbers.** Newsreader for: the home statement, page-level
   statements on index pages, big stat numerals, theme names on theme pages, teardown titles.
   Instrument Sans for all interface text. Geist Mono for labels, numbers in tables, versions.

## Composition rules

- **Asymmetry over centring.** Default to a 12-column grid with content starting at column 1
  and statements spanning 7–8 columns; supporting text/specs sit at columns 9–12. Centred
  layouts only for the 404 and sign-in.
- **Scale contrast.** Each page has one very large thing (a statement, a capture, a name) and
  everything else is small and precise. Avoid medium-everything.
- **Hairlines, not boxes.** Separate with 1px rules and whitespace. Cards with backgrounds only
  for screenshot wells and floating UI.
- **Density where it helps.** Index/tables are dense (12–14px), captures are big.
- **Motion with purpose only:** the home wall drifts slowly (pauses on hover, off with reduced
  motion); section outlines fade in on hover; index preview follows the cursor. No scroll-jacking,
  no parallax, no entrance animations on text.
- **Honest data styling.** Numbers always carry a mono source line. Placeholders are named as
  previews. Empty states say what to do next.

## Per-page intent

- **Home:** Statement in Newsreader spanning 8 columns ("Every Shopify theme and app, seen on
  real stores.") with a live, dated spec line in mono beneath. Immediately a dark **wall** of
  drifting columns of store captures (desktop + mobile mixed) with domain pills — the product
  shown, not told. Then: themes as an index with mini decks; most-installed apps as a ranked
  index; section types as a typographic list with counts and a crop preview; teardowns as an
  editorial pair; compare/alternatives as a short index; the API/MCP line for builders.
- **Index pages (stores, themes, apps, sections, teardowns, compare, alternatives):** big title
  with superscript count, one-line statement, filter bar (chips = URL state), Grid ↔ Index
  toggle, result count in mono. Never a generic card grid with icons.
- **Detail pages (store, theme, app):** a "specimen sheet": N° label + name very large (theme
  names in Newsreader), spec rows block (mono labels), CTA with affiliate label, then the plates
  (captures) with page-type tabs and device toggle, then relationships as indexes (stores using
  it, apps with it, alternatives) — each with its own count and source line.
- **Store detail:** the full-page viewer is the hero: plates per page type, sections rail with
  N° numbering and app attribution, crop marks around the stage.
- **Compare:** two specimens side by side at identical scale on a dark stage, then a narrow fact
  table (✓ in ink, × in light gray). No winners, no colour coding.
- **Sections library:** Mobbin-like browsing but with our captions; section type list on the
  left reads like a book's table of contents (type, count, page numbers style).
- **Teardowns:** long-form editorial. Newsreader title, dek, numbered annotations tied to
  sections on the capture (the numbers match the sections rail), pull quotes, spec sheet sidebar.
- **Static/legal:** book-like: narrow column, sticky TOC with numbered headings, Newsreader title.
- **Pro:** a spec-sheet comparison of plans, not glowing cards. One plan emphasised with an ink
  rule, not colour.
- **Admin:** dense, quiet, functional (Linear-like). Signature elements optional.

## References (Mobbin)

- Catalogue index rows — Waka Waka: https://mobbin.com/sites/sections/fe089d5d-5adb-4849-a282-ae46d8fd7eac
- Year/column index — OpenAI: https://mobbin.com/sites/sections/1e4d6891-db02-4b62-8ae8-8addb56aa87e
- Index rows with location columns — Escape Cafe: https://mobbin.com/sites/sections/458fe700-42b9-4932-83fc-4f7ceb6db9a8
- Spec labels with square bullets — FREITAG: https://mobbin.com/sites/sections/cac5c6fe-01b5-4769-8972-a2d70c190673
- Stat tiles with crop marks + mono labels — Spade: https://mobbin.com/sites/sections/34a2151f-c9b2-4121-b790-8e85202fe9ca
- Serif numerals — Legora: https://mobbin.com/sites/sections/2cf16054-0dd8-4dcc-8358-a8fbb6dad125
- Editorial statement — SSENSE: https://mobbin.com/sites/sections/4de98a06-dbff-4e54-83c6-a301c519bba0
- Wordmark footers — Structured: https://mobbin.com/sites/sections/cf954a98-4f2e-41d3-b2a1-168e4ba0108d · MOUTHWASH: https://mobbin.com/sites/sections/082f5fac-4648-4314-aa7d-a06fe0235b77 · BAGGU: https://mobbin.com/sites/sections/ddfad441-10db-4949-9baa-299e7e0edeee
- Wall of work on dark — Studio Freight: https://mobbin.com/sites/sections/e17cb69f-b5cd-4aa4-90ca-82838a400641
- "How it's built" metadata panel — Save.design: https://mobbin.com/sites/sections/5d172c3c-286c-459f-a701-b1ddabdd2324
- Domain pills under captures — Ploy: https://mobbin.com/sites/sections/e40ee229-9192-4fbd-8978-eae4dc3158ed
- Gallery tiles — Mobbin Sites: https://mobbin.com/screens/78c8c297-b03a-4030-a8f2-25ab2e9bd133
- Marketplace detail anatomy — Notion: https://mobbin.com/screens/4d94f414-f33f-4e7b-adf3-e8f58285ffe0 · Vercel: https://mobbin.com/screens/f9ebd5a4-c177-4ad4-badd-c686bd3304cb
- Mono editorial headline — Sketch: https://mobbin.com/sites/sections/be1166ac-1385-4279-9830-a24faacb1a0b
- Minimal numbered list — ZARA: https://mobbin.com/screens/b2bbd6ce-b769-48be-916d-6f12efd23b58
