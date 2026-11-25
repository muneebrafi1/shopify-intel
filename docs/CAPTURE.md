# Capture pipeline (local)

Real home-page screenshots of the curated stores, taken on your machine and loaded into the
**local** dev bindings. Nothing is uploaded to Cloudflare, nothing is deployed.

```bash
npm run setup                       # once: local D1 with the placeholder plan
npm run capture                     # all curated stores, desktop 1440 + mobile 390
npm run capture -- --only youngla.com,thesill.com --devices desktop
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
   - refuses pages that are not plain Shopify storefronts: bot checks (`challenge`), password
     pages, non-Shopify pages, HTTP errors. No logins, no form submissions, no bypassing;
   - height cap: 14,000 CSS px on desktop, 8,000 on mobile (WebP's 16,383 px limit at 2×).
     Cut captures are flagged `truncated` in the manifest.
3. **Sections from the DOM** (`scripts/capture/classify.ts`): every top-level
   `.shopify-section` box, named from its template key (`sill_featured_collections_m4fNxM` →
   featured collection), its `shopify-section--<type>` class, its section group
   (header/footer/overlay) or the app blocks inside it. Unnamed sections are dropped rather
   than guessed (they stay visible in the screenshot; `diagnostics.unclassified` lists them).
   App blocks are attributed to an app only when the store's detected apps include it.
   `hints_json` records `classified_by` (`name`, `class`, `app-block`, `position`).
4. **Images** (`scripts/capture/process.ts`, sharp): full page and one crop per section, WebP
   q78, written to `.data/captures/objects/<r2 key>`:
   - `shots/{domain}/home/{device}/{YYYYMMDDTHHMMSSZ}.webp`
   - `crops/{domain}/home/{device}/{stamp}/{order}-{section type}.webp`
5. **Manifest** `.data/captures/manifest.json`: the latest capture per store × page × device in
   the exact shape `ingestCapture()` accepts, plus diagnostics and failures.
6. **Ingest** (`scripts/capture/ingest-local.ts` → `src/server/repo/ingest.ts`): objects go into
   the local R2 bucket, rows into the local D1, then `rebuildDerived()`. A placeholder
   screenshot is replaced in place (same id, so teardown notes keep working and are re-pointed
   at the detected section of their type); an older real capture is kept as history
   (`is_current = 0`). Blocked domains are refused at this step too.

The UI needs no change: a screenshot row with an `r2_key` and `is_placeholder = 0` is served
from `/media/<key>`, and sections with an `r2_key_crop` show their real crop.

## Known limits

- Home pages only for now. Collection, product and cart pages need URL discovery (first
  collection/product link from the home page; cart with one item added) — next milestone.
- A few sites render parts of the page only inside the real viewport (scroll-driven reveal
  effects); those parts can come out blank in a full-page capture (seen on The Sill's footer
  link columns at 1440). A stitched viewport-by-viewport capture would fix it.
- Grids load the full-page WebP until thumbnails exist (precut `…/{stamp}.top.webp`, or
  Cloudflare Image Resizing via `IMAGE_TRANSFORMS`).
- Captured images are third-party store content: they stay out of git (`.data/` is ignored)
  and go to R2 only once the owner approves the production pipeline.
