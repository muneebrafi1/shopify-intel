# Product brief

Working name: **shopify-intel** (brand TBD — always use the `SITE_NAME` constant).
Owner: Muneeb Rafi. Source: business plan of 17 Nov 2026 plus decisions made since.

## One line
**Mobbin for Shopify.** See how every Shopify theme and app really looks on live stores, page by
page and section by section, on desktop and mobile — before you buy or install it.

## Why this exists (the gap)
The "detector + stats" market is crowded; the visual, design-first layer is not.

| Already taken | Who |
|---|---|
| Theme detection, "stores using theme X" counts | OnShopify, Store Teardown, StackCrawler, Store Detector |
| App install counts and trends | StoreCensus (2.44M stores), Store Leads ($75–950/mo) |
| Spy features (best sellers, ads, revenue estimates) | Koala Inspector, PPSPY, ShopHunter |
| Homepage screenshot galleries | Store Detector (~20K homepage shots), ecomm.design |
| Generic tech lookups | BuiltWith ($295+/mo), Wappalyzer |

The opening:
- Nobody offers a Mobbin-style library of **real Shopify pages** filterable by theme, preset, page
  type and section/component.
- **Store Detector (storedetector.com) — the competitor to beat** — shows only the homepage,
  above the fold, one shot per store, in 19 categories. No mobile, no product/collection/cart pages,
  no sections, no "this theme on real stores" view. It also has an MCP server and Pro at
  $4.99–9.99/mo. We win on **depth, design quality and honesty**, not raw count.
- What an app's widget looks like on 40 real stores (e.g. Judge.me or Loox reviews) is not shown
  anywhere.
- Honest data: we never invent revenue numbers (the top complaint about spy tools).

## Core differentiator
1. **Full-page screenshots of every page type** — home, collection, product, cart, search,
   blog/article, about, 404… — on **desktop and mobile**.
2. Each page is **sliced into tagged sections** (announcement bar, header, hero, featured
   collection, product gallery, buy box, reviews, upsell, FAQ, newsletter, footer…), browsable like
   Mobbin screens: "show me product-page review sections on stores using Prestige".
3. **Everything is interlinked**: app ↔ stores, theme ↔ stores, store → its theme + apps, section →
   store/theme/app that renders it.
4. **API-first**: one data layer powers the website *and* a future **MCP server** so Claude /
   ChatGPT can pull real store references (screenshots, sections, theme/app stacks) while they help
   people build Shopify stores. Our name and affiliate links travel with every answer.

## Who it's for
| Segment | Value | Pays how |
|---|---|---|
| Merchants choosing a theme or app (lead / traffic engine) | See it on real stores before paying; honest comparisons | Affiliate commissions |
| Designers, agencies, freelancers (first paid tier) | Mobbin-style library of real Shopify pages by theme, page type, section; boards for client pitches | Pro / Team subscription |
| App developers | Who uses competitor apps, who switched, co-installs | Pro / reports later |
| Theme developers | Where their theme is used, presets, switches | Reports / sponsored later |
| AI builders (Claude/ChatGPT users, devs) | Real design references via MCP/API | API / MCP plan later |

## Site sections (all must exist in the base build)
- **Home** — the product promise shown, not told: a live-looking grid of real store pages,
  entry points to Themes / Apps / Stores / Sections, search.
- **Themes** — index (filter by price, vendor, style, industry) and **theme detail**: real stores
  using it, their screenshots by page type and device, presets, vendor, price, official link
  (affiliate when we have one), similar themes.
- **Apps** — index + categories, and **app detail**: App Store facts (rating, reviews, pricing,
  developer), "seen on" real stores with screenshots of where the app shows up, co-installed apps,
  alternatives.
- **Comparisons** (`/compare/a-vs-b`) and **Alternatives** (`/alternatives/app`).
- **Top Stores** — index (filter by theme, app, category, country/currency) and **store detail**:
  theme + version, apps, full-page screenshots per page type, desktop/mobile toggle, sections.
- **Store Teardowns** — editorial deep dives on a top store: screenshots, sections, which app powers
  which part of the page, "what to learn from it". Strong SEO and social content.
- **Sections library** (Mobbin-style browsing) — all sliced sections, filter by section type, page
  type, device, theme, app.
- **Search** — instant, keyboard-first, across stores, themes, apps, sections.
- **Static/legal**: About, Methodology (how detection works, data dates), Affiliate disclosure,
  Privacy, Terms, **Store opt-out / removal request page** (store owners can ask to be removed).
- **Admin** (protected, not public): manage stores/themes/apps, trigger rescans, review removal
  requests, edit affiliate links, curate teardowns.
- **Account placeholders**: sign-in, saved collections/boards, Pro upgrade — designed and routed now,
  wired later.

## Decisions made
- Launch base with **~50 apps, ~20 themes, ~20 stores** (seed in `data/seed/`). The main job now is
  a **polished, complete design and interface for every section and page**. Data grows later
  (target ~50K detected stores, ~1,500 curated stores with 6–7.5K screenshots).
- **Affiliate links first** (Gorgias, Appstle, Shoffi apps, FoxEcom apps/themes, Booster Theme…;
  more pending). Every affiliate link is labelled; detections are never influenced by partnerships.
- **Subscription later via Whop** (Stripe is not available in Pakistan). Sketch: Free / Pro
  $12/mo or $96/yr / Team $39/mo / launch lifetime deal $79 for the first 100.
  Pro = full screenshot library (every page type, desktop+mobile), filters by section/theme/app,
  boards, CSV exports, theme-switch alerts.
- **Accounts and saved collections**: plan the data model and UI slots now even though login
  comes later, so Pro needs no redesign.
- **SEO-clean URLs**: `/themes/prestige`, `/apps/judgeme`, `/stores/thesill.com`,
  `/compare/judgeme-vs-loox`, `/alternatives/klaviyo`, `/teardowns/<store>`, `/sections/<type>`.
  Canonicals, JSON-LD, sitemaps, fast pages.
- **Data history from day one**: every detection has first_seen/last_seen so "recently switched"
  and trends are possible later.
- Data comes from **our own crawler on public pages only** (respect robots.txt, low rate). We may
  look at competitor lists to know which stores are notable, but never copy their database or their
  revenue estimates.

## Future ideas (design hooks now, build later)
- **Theme Matchmaker** — tell us your niche/budget, get themes shown on real stores like yours.
- **"Recently switched" feed** — stores that changed theme or added/removed apps (leads for app
  devs and agencies; Pro feature).
- **Free tools** — "what theme is this store using", "score my store", linked to the existing
  StorePeek Chrome extension.
- **MCP server / public API** for Claude, ChatGPT and developers.
- Insights layer later: theme-switch and app-growth trends, monthly "State of Shopify themes"
  report.

## Design principles
- Image-first like Mobbin and Are.na: real screenshots fill the page, the interface stays quiet.
- Mobbin / Linear / Apple / Stripe level craft. Neutral warm grays, one accent colour, generous
  whitespace, dense but calm grids, precise typography (a characterful grotesk for UI, optionally an
  editorial serif for big headings).
- Every number shows its source and date. Filters are chips; keyboard shortcuts; instant search.
- **Never look AI-generated**: no purple-blue gradients, glassmorphism cards, emoji headings,
  "Unlock the power of…" copy, stock 3D blobs, icon-in-a-circle feature grids, or generic SaaS
  hero templates.
- Use the **Mobbin** and **screendesign** connectors (and real sites) for references. Look at how
  the best sites solve each specific page, then do it better for our content.
- Microcopy is short, plain and specific.

## Constraints
- Free Cloudflare preferred (see `ARCHITECTURE.md`).
- The Chrome extension (StorePeek) is a separate project; its detection rules (454 apps,
  signatures v7) are the source for detection logic.
- The previous site (storepeek.pages.dev: 879 app pages, 150 vs, 150 alternatives, ~420 theme
  pages) will be migrated into this one later.

## Risks to keep in mind
| Risk | Mitigation |
|---|---|
| Crowded market (Store Detector shows 20K homepage shots for $5–10) | Win on depth (multi-page, mobile, sections), design and trust |
| Thin affiliate coverage (Klaviyo, Judge.me pay nothing) | Lead with themes and page builders; chase pending programs |
| SEO is slow; old site appears unindexed | Own domain, Search Console, fewer but richer pages |
| Stores block crawlers | Real browser, low rate, honour robots.txt |
| Screenshot takedown requests | Link back to the store, removal page, fast admin handling |
