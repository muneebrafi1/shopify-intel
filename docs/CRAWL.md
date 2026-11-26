# Storefront crawl and Theme Store facts (local)

Two local jobs keep the store and theme facts fresh. Neither uploads, deploys or writes to
Cloudflare: the crawl writes a file on your machine, and `crawl:ingest` only talks to a local
dev server. Production ingest waits for the owner's go-ahead.

```bash
npm run crawl -- --curated              # every curated store in the local D1
npm run crawl -- --domains a.com,b.com  # some stores (curated or not)
npm run crawl -- --curated --concurrency 2
npm run crawl:ingest                    # POST each scan to http://127.0.0.1:4321 (astro dev)
npm run crawl:themes                    # Theme Store facts → data/curation/theme-store.json
npm run crawl:themes -- --only prestige
```

## Storefront crawl (`scripts/crawl/`)

- **Detection rules are StorePeek's** (the owner's extension, `STOREPEEK_DIR`, default
  `/workspace/extensions/storepeek`): `collect.ts` gathers what StorePeek's collectors read on a
  page (scripts, `Shopify.theme`, app blocks, cookies, pixels) in headless Chromium and runs its
  `analyze()` on it. The engine is imported at run time, never copied into this repo.
  `rules_version` records the signatures version (`storepeek-signatures-v9`).
- One home-page visit per store. Stores showing a bot check or a non-Shopify platform are
  recorded as such and change nothing else. Stores blocked from capture (removal requests) or
  opted out are skipped before the visit.
- Output: `.data/crawl/scans.json` (gitignored), merged by domain.
- `Shopify.country` follows the visitor's market, not the store's, so it is not used.

## Ingest (`POST /api/v1/admin/scans`)

`npm run crawl:ingest` sends one scan per request (the D1 free plan allows 50 statements per
request) with the bearer `ADMIN_API_TOKEN` from `.dev.vars` (a local throwaway value, 32+
characters; never commit it). The script refuses any base other than `127.0.0.1`/`localhost`.

What a scan changes (`src/server/repo/scans.ts`, `ingestScan`):

- a `scans` row with the raw result (source `vitrine-crawl`, rules version, HTTP status);
- the store's URL, currency and `last_seen`; its name only when the editorial name is empty;
- theme history: a new theme or version closes the old `store_themes` row and opens one; a
  scan without a version is not a change;
- apps (matched by slug or alias) and pixels (known `PIXELS` keys) are added or refreshed;
  unknown app slugs go to `store_unresolved_apps`. A crawl never removes an app it did not
  see (one page load can miss apps that load late);
- `meta.crawl_last_at` / `crawl_rules_version`, shown as the `vitrine-crawl` entry of
  `meta.sources` (the store page's detection source then links to it);
- with `rebuild: true` (the default) the derived counts are rebuilt after the scan.

Refused: tombstoned or opted-out stores, and stores not in the catalogue (the crawl does not
add stores; curation does).

## Curated stores

`data/curation/stores.json` lists the curated stores. The first 20 come from the export
`data/seed/stores.json`; the rest were picked from `detections-930.json` (one or two per
catalogue theme, the stores with the most detected apps, kept only when a crawl confirmed
Shopify, an exposed theme and no bot check). Until a crawl is ingested, those stores show the
detection export's facts (no version, confidence or pixels). Names, categories and countries
in that file are editorial: country only from a ccTLD or an unambiguous currency.

## Theme Store facts (`scripts/crawl/theme-store.ts`)

Reads each theme's public Theme Store page (`themes.official_url`), one request every 1.5 s,
and records what Shopify publishes there: presets, the feature list in its groups, the current
version and the review summary, with the page URL and the date checked. The seed loads them
into `theme_presets`, `theme_features` and the Theme Store columns of `themes` (migration 0003);
`meta.theme_store_checked_from/to` date them. The Theme Store publishes no style or industry
tags, so `theme_tags` stays empty: nothing is invented.
