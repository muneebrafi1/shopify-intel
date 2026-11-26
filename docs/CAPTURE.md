# Capture pipeline (local)

Real screenshots of the curated stores' home, collection, product and cart pages, taken on your machine and loaded into the
**local** dev bindings. Nothing is uploaded to Cloudflare, nothing is deployed.

```bash
npm run setup                       # once: local D1 with the placeholder plan
npm run capture                     # all curated stores × 4 pages × desktop 1440 + mobile 390
npm run capture -- --only youngla.com,thesill.com --devices desktop
npm run capture -- --pages product,cart --stitch   # some pages, force stitched mode
npm run capture -- --resume         # skip pages already captured with the current rules
nohup npm run capture -- --resume > .data/capture.log 2>&1 &   # long runs: background + log
npm run capture:ingest              # stop `astro dev` first; restart it afterwards
```

`npm run setup` recreates the local D1 with placeholders only, so run `npm run capture:ingest`
again after it (no new capture needed: it re-reads the manifest; R2 objects are kept).

## What it does

1. **Work list** from `listCaptureTargets()` on the local D1 (curated, active, not blocked,
   not tombstoned), and `isCaptureBlocked()` again right before each store (contract in
   `docs/ARCHITECTURE.md`, "Capture blocks").
2. **Browser** (`scripts/capture/browser.ts`, Playwright Chromium):
   - desktop 1440×900 at 1×, mobile 390×844 at 2× with an iPhone user agent;
   - normal motion (some themes never reveal a slideshow under reduced motion), service
     workers blocked, `en-US`;
   - consent banners and store popups: known accept/close buttons are clicked, known widgets
     (chat, Klaviyo/Privy/Attentive popups, cookie banners) and other fixed overlays outside the
     theme header are hidden;
   - scrolls the page in steps so lazy images and scroll animations load, waits for images;
   - **stitched mode** for stores listed in `data/curation/capture.json` (`stitch`) or with
     `--stitch`: the page is shot one viewport at a time while scrolling and the tiles are
     composited (sharp). Fixed and sticky elements are hidden after the first tile so the header
     appears once. Use it for themes that only draw content inside the real viewport (The Sill's
     footer columns came out blank in a one-shot full-page capture). Tile count is capped and
     the loop stops if the page stops scrolling;
   - refuses pages that are not plain Shopify storefronts: bot checks (`challenge`), password
     pages, non-Shopify pages, HTTP errors. No logins, no form submissions, no bypassing;
   - height cap: 14,000 CSS px on desktop, 8,000 on mobile (WebP's 16,383 px limit at 2×).
     Cut captures are flagged `truncated` in the manifest.
3. **Pages** (`discoverPages()`): the collection and product URLs are the first
   `/collections/<handle>` and `/products/<handle>` links on the home page (main content
   first; `all`, `frontpage`, `vendors`, `types`, `sale` and gift cards skipped), falling back
   to `/products.json?limit=1` and `/collections/all`. The cart page is `/cart` with one item:
   the product's first available variant is added through the storefront's own
   `POST /cart/add.js` in the throwaway browser context (no checkout, no account, nothing
   personal), and Escape closes cart drawers. Each capture has a 240 s timeout; failures are
   recorded per store × page × device and keep the previous good entry.
4. **Sections from the DOM** (`scripts/capture/classify.ts`): every top-level
   `.shopify-section` box, named from its template key (`sill_featured_collections_m4fNxM` →
   featured collection), its `shopify-section--<type>` class, its section group
   (header/footer/overlay) or the app blocks inside it. Unnamed sections are dropped rather
   than guessed (they stay visible in the screenshot; `diagnostics.unclassified` lists them).
   App blocks are attributed to an app only when the store's detected apps include it.
   `hints_json` records `classified_by` (`name`, `class`, `app-block`, `position`).
   Page-specific rules: collection header/filters/product grid on collection pages, buy box,
   product details and recently viewed on product pages, cart items/summary on the cart. The
   hero-by-position guess applies to home pages only. A product section with an add-to-cart
   form is split into **product gallery + buy box**: side by side on desktop (crops cut at the
   column, `hints.column` left/right), stacked on mobile. The buy box is the form's ancestor
   narrower than 72% of the section; the gallery is the largest image block beside or above it.
5. **Images** (`scripts/capture/process.ts`, sharp): full page and one crop per section, WebP
   q78, written to `.data/captures/objects/<r2 key>`:
   - `shots/{domain}/{page}/{device}/{YYYYMMDDTHHMMSSZ}.webp`
   - `shots/{domain}/{page}/{device}/{stamp}.top.webp`: the **pre-cut top thumbnail** (top
     1× width on desktop, 2.9× on mobile, 960/600 px wide). `thumbUrl()` in `src/lib/media.ts`
     picks it whenever a grid's crop fits inside it, so grids never download a full page.
     Free, unlike Image Resizing (`IMAGE_TRANSFORMS`). Ingest backfills it for older captures.
   - `crops/{domain}/{page}/{device}/{stamp}/{order}-{section type}.webp`
6. **Manifest** `.data/captures/manifest.json`: the latest capture per store × page × device in
   the exact shape `ingestCapture()` accepts, plus diagnostics and failures.
7. **Ingest** (`scripts/capture/ingest-local.ts` → `src/server/repo/ingest.ts`): objects go into
   the local R2 bucket, rows into the local D1, then `rebuildDerived()`. A placeholder
   screenshot is replaced in place (same id, so teardown notes keep working and are re-pointed
   at the detected section of their type); an older real capture is kept as history
   (`is_current = 0`). Blocked domains are refused at this step too.

The UI needs no change: a screenshot row with an `r2_key` and `is_placeholder = 0` is served
from `/media/<key>`, and sections with an `r2_key_crop` show their real crop.

## Known limits

- One collection and one product per store (the first linked from the home page), so the
  product page is whatever the store features first.
- Cart pages that open a drawer instead of a page, or need a region selector, may show the
  store's empty-cart or drawer state; check `diagnostics` and the screenshot.
- Stitched mode is per store (`data/curation/capture.json`): it is slower and can repeat
  elements that change position on scroll, so it is not the default.
- Sections without a recognisable theme name are classified by content (product cards, images,
  email fields, text) or by their header/footer group since #15; the few left are listed in
  `diagnostics.unclassified`. Captures taken before #15 have no `raw` sections, so
  `npm run capture:reprocess` skips them: re-capture those stores instead.
- Captured images are third-party store content: they stay out of git (`.data/` is ignored)
  and go to R2 only once the owner approves the production pipeline.
