# Design reference research

Research for the "Mobbin for Shopify" site, done 2026-11-17 with the Mobbin MCP (web screens, site
sections, flows; iOS only for mobile sheets and menus). Every link below is the exact `mobbin_url`
the tool returned.

**Screendesign was not usable.** Every call failed with: *"Your subscription payment needs
attention. The organization owner can retry payment or open the billing portal from
https://screensdesign.com/settings/account."* The owner needs to fix billing before anyone can use
that connector. Its mobile-app content is covered here by Mobbin iOS results.

**How to read the measurements.** I estimated them from ~768px-wide previews of desktop captures
and scaled them to a 1440px viewport (about x1.9). Treat them as proportions to start from, not
pixel-exact specs.

---

## 1. Gallery / library grid with filters

References
- [Mobbin: Sites grid, filtered by "3D"](https://mobbin.com/screens/78c8c297-b03a-4030-a8f2-25ab2e9bd133?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mobbin: web Screens grid, hover Save/Copy, "Showing 932 screens"](https://mobbin.com/flows/0e97d927-4170-40b8-9acf-5e75974bfa7f?tab=screens&utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mobbin browse home: category mega-list + Latest / Most popular / Top rated (captured under a Navattic overlay)](https://mobbin.com/screens/d324bd68-c775-4098-b62a-b63ff21333d2?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Record Club: type tabs with counts, "Showing 1–84 of 3463.7K", sort + view toggle](https://mobbin.com/screens/53fd0257-8ad0-4b7b-abc6-a29236257ca8?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Dribbble: category tabs + expandable filter row (Tags / Color / Timeframe)](https://mobbin.com/screens/6421594e-d3bd-41fa-8681-32731b9ae453?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Pinterest: left filter panel with sticky Reset / Apply](https://mobbin.com/screens/8125825e-ee41-41d8-977f-af4073b17979?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Mobbin Sites tile anatomy (the model for store tiles).** A light neutral-gray container with
  ~16-20px radius and no border. The screenshot sits inset and centred with ~8-10% padding on every
  side and its own small radius. Below the tile, 12px down: a 20px app icon, the name at 14/20
  medium, and the tagline at 13/18 in secondary gray. 3 columns at 1440, ~32px page gutter,
  ~16px column gap, ~28px row gap. The gray frame means mixed aspect ratios still line up in one
  even grid. Use the same frame for section slices, which are wide strips.
- **Mobbin web Screens tile.** Real 16:10 desktop crops with a 1px hairline border and ~10px
  radius, 3 columns. A translucent dark-gray "Highlight" pill sits top-left at 11px. On hover a
  ~40% black overlay appears with two equal pills along the bottom: **Save** (white) and **Copy**
  (white at 20%). Save opens a small white popover: "All saved" with a bookmark icon, a gray
  "Add to collection" label, then "+ Create collection". After saving, the pill reads "Saved".
- **Filter bar = outlined dropdown pills, not a sidebar.** Examples: `Jun 2023 ▾`, `Screens ▾`,
  `Text in Screenshot ▾`, ~36px tall, full radius, 1px border. An applied filter becomes a chip
  with a dark 1.5px border and an ⊗ (`3D ⊗`). The count goes top-right as two small gray lines
  ("Showing / 932 screens"). Copy the version filter (`Jun 2023 ▾`) as our "Captured Nov 2026 ▾"
  snapshot selector.
- **Type tabs carry counts.** Record Club uses a segmented control: `All 3462.5K | Albums 1976.4K`,
  with the count in tertiary gray after the label. Under it sit small text dropdowns
  (`Year: All ▾`) and "Showing 1–84 of N" in tertiary gray. Sort (`⇅ Popularity ▾`) and a
  grid/list toggle go on the right. Do the same for Stores / Themes / Apps / Sections.
- **Mobbin browse home.** Above the grid sit four columns of large links (~18px): Categories,
  Screens, UI Elements, Flows. They act as the category index. Then an iOS/Web segmented toggle,
  text tabs `Latest · Most popular · Top rated` (active = dark text, inactive = tertiary, no
  underline), and `Filter` at the far right. "New" and "Updated" badges go top-left on tiles.
- **Dribbble's metadata row.** 20px avatar, name at 13 medium, an optional `PRO` micro-badge, then
  ♥ and 👁 counts right-aligned in gray. The `Filters` pill expands an inline row of three inputs,
  each with a "Clear" link. Tiles are 4:3 with an 8px radius in 4 columns. Too many columns for
  store pages: use 3.
- **Desktop sidebar filters (Pinterest).** The panel is ~340px with radio and checkbox groups,
  collapsible headers, and sticky `Reset` (gray) and `Apply` (brand) at the bottom. Only use a
  sidebar for 5+ facets, such as the Sections library. Elsewhere, use pills.
- **Sort lives behind a small icon button** (Cosmos's ⇅ opens Relevant / Latest / Oldest / Popular
  / Random). Keep sort out of the chip row so the chips only mean "filter".

## 2. Screenshot detail modal / lightbox

References
- [Savee: dark lightbox, right info panel, palette, "Add to a board"](https://mobbin.com/screens/cd0ad462-7dc0-4ece-b559-5f9264b524e9?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Magnific: white modal, Details/Comments panel, prev/next outside the modal](https://mobbin.com/screens/cd55d477-141f-46c2-b99c-658ac106df75?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mobbin: app page, multi-select + floating action bar + save popover](https://mobbin.com/screens/c87b4b5b-e3c1-46ea-bcf3-f8ce47de1834?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mobbin flow: Saving a screen (select → collection popover → saved)](https://mobbin.com/flows/cbf311c6-51ee-49fa-b6c2-b65e2d0bc808?tab=screens&utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Meetup: "1/11" counter, labelled Download / Report / More icons](https://mobbin.com/screens/fc29edd4-8f42-4257-9455-fd4b3600e183?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mobbin: modal style (centred title, gray-filled inputs, pill buttons)](https://mobbin.com/screens/9230da33-042b-4ae8-b403-43dbfee0ea23?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Layout: image canvas plus a fixed right panel of ~340px (about 23% of 1440).** Savee puts the
  image on a near-black canvas. Magnific uses a white modal inset ~48px from the viewport, with
  the panel as a light-gray inset card. For long full-page store screenshots, make the canvas
  scroll vertically inside itself while the panel stays put.
- **Panel order (Savee):** the source domain as an underlined 13px link, then the title, then
  meta (`3d ago · +63 · 329`), then the colour palette as 4 circular swatches (~32px), then an
  `Add to a board ▾` outlined select at 8px radius, then the boards it is already in, then
  comments. For us the order is store domain ↗, page type + device, theme chip, app chips,
  palette, then `Save to board ▾`.
- **Top bar:** back chevron on the left. On the right: a split `Saved ▾` button and icon buttons
  for info, comment and more. Meetup labels its icons (Download / Report / More) at 10px, and it
  reads better. Use labels for anything less common than Save.
- **Prev/next** are white 32px circles outside the modal on the viewport edges (Magnific), plus
  a `1 / 11` counter centred at the top (Meetup). ← → keys must work. Esc closes.
- **Related strip:** Savee shows a filmstrip of related images peeking at the bottom edge, and
  Magnific has a `Similar images ▾` button under the image. Use a bottom row titled "More from
  this store" or "Same section type".
- **Multi-select (Mobbin):** a selected tile gets a 2px accent outline and a filled check circle
  top-left. A dark floating pill bar is centred at the bottom:
  `1 selected | Clear | ⤓ | Copy | [Save]`, where Save is a white pill. A "✓ Saved" toast appears
  above the bar. This is the most "Mobbin" interaction to copy for boards.
- **Mobbin modal chrome:** white, ~20px radius, centred 15px semibold title, a close × in a 28px
  gray circle top-right. Inputs have a gray fill (#F0F0F0-ish), no border and 10px radius. The
  buttons are full-radius pills: Cancel is outlined white, the primary is solid near-black. Our
  primary uses the accent instead.

## 3. Directory index pages (dense rows vs cards)

References
- [Vercel: AI Gateway leaderboards, two-column ranked rows](https://mobbin.com/screens/abbadfbe-0db6-453b-b9bc-ccb7ce2d60ed?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Vercel: integrations marketplace, type + category rail](https://mobbin.com/screens/82426445-002e-4bb6-ab23-72e90b793690?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [LangChain: grouped two-column compact row cards with status](https://mobbin.com/screens/c3ee2df7-4268-4daa-a45d-194770781ec6?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Canva: apps directory, category sections with "See all"](https://mobbin.com/screens/c4c30fba-d21d-406f-945a-499b332e80e4?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Gorgias: app store, category list + 4-column cards](https://mobbin.com/screens/518845e8-5e8a-4c82-9cf0-5b37fe2c6ff2?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Uniswap: ranked token table, right-aligned numerals, sparklines](https://mobbin.com/screens/0543de03-b322-4c29-9660-cfbf69158824?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Use rows for apps and cards for anything visual.** Apps have no strong visual, so a dense
  row reads faster: a 32-40px icon, the name, a one-line tagline and one or two facts. Themes and
  stores are visual, so they get screenshot tiles (§1). Gorgias-style 4-column logo cards with
  three lines of text waste space.
- **Vercel leaderboard row:** a monospace rank number in tertiary gray, a 32px square icon with
  6px radius, the name at 14 medium with a small `›`, and a tagline at 13 in secondary gray. Rows
  are ~56px with no dividers, 5 per column and 2 columns per block. Each block has a heading at
  16 semibold and a one-line gray description ("Most popular … this week"). Use this for "Top apps
  on top stores" on the Apps index.
- **Table version (Uniswap):** columns `# | App | Rating | Reviews | Stores using | Trend`, numbers
  right-aligned in tabular figures, a sortable header showing the active sort as `↓ Volume`, a
  sparkline in the last column, and a 2-line name cell (name + vendor in gray). The category pills
  above the table (`Popular · Stocks · Commodities`) have gray-fill active states.
- **Category navigation:** a left rail ~220px of plain text links. The active link gets a light
  gray fill and 6px radius, and counts are optional. Vercel splits the rail into "Any Type" and
  "Any Category" groups with 16px line icons. On mobile it becomes a horizontal chip scroller.
- **Grouping:** LangChain groups rows under small uppercase vendor headers (11px, tracking +4%,
  tertiary gray) in a 2-column grid of compact bordered rows (~64px). A state pill sits on the
  right (`● Connected` green, `Missing scopes` amber, or an outlined `Connect` button). Our
  version: "Running on 412 stores" on the right instead of a button.
- **Canva category sections:** an 18px semibold heading with `See all` right-aligned in gray, then
  3 columns × 2 rows of 40px-icon rows. This works as the default Apps index above the full
  filtered list.

## 4. Product / app / theme detail page

References
- [Notion Marketplace: template page with facts strip](https://mobbin.com/screens/4d94f414-f33f-4e7b-adf3-e8f58285ffe0?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Zendesk Marketplace: theme page, serif title, desktop + phone mockup](https://mobbin.com/screens/5ea90a74-b1ed-4ffe-b5a3-206a7f0847de?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [VS Code extension (in v0): header + right facts sidebar](https://mobbin.com/screens/7b96e65f-c892-4bf4-8568-2978c35bf5e7?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Upwork: sticky right pricing card with plan radios](https://mobbin.com/screens/7f0c60ca-ca6d-4b77-a0b6-1e271f16c28a?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Snowflake Marketplace: tabs + category / contact / docs sidebar](https://mobbin.com/screens/6862cb76-5ca3-4a2a-8549-78605ae78dea?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Semrush App Center: meta rail + plan card](https://mobbin.com/screens/e8923409-b85c-475e-ad3b-999e667bc85a?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Header (Notion):** two columns, about 40/60. On the left: a small author line (avatar + name,
  12px), a 2-line title at ~32px semibold, 3-4 lines of description, then `+ Add` (filled) and
  `Preview` (tinted) buttons with a share icon. On the right: a large preview in a 1px-bordered
  frame with 8px radius, and a row of thumbnails below it (the active one gets an accent border).
  For a theme: a store screenshot plus a page-type switcher (Home / Collection / Product / Cart).
- **Facts strip under the header (Notion).** One row between hairlines, 6 equal cells. Each cell
  has the value at 14 medium on top and the label at 12 gray below:
  `Immi / 4 templates · #1 in Marketing / Ranking · ★ 4.9 / 600+ ratings · 35K+ / Downloads ·
  35 weeks ago / Version update · EN / Languages`. Copy this exactly for apps (Rating, Reviews,
  Price from, Stores tracked, Category, Last seen) and themes (Price, Version, Stores using,
  Presets, Vendor, Updated).
- **Theme pages can be warmer and editorial (Zendesk).** A serif name at ~40px, stars plus
  `(13) See 13 reviews`, a 16px description, then `View demo` (outline pill) next to `Install`
  (filled pill). A gray fine-print requirement line goes under the buttons. On the right, a
  desktop screenshot overlaps a phone mockup, with a `Show 10 screenshots` link below. Use Newsreader
  for the theme name, but show real stores, not vendor mockups.
- **Facts sidebar (VS Code / Snowflake):** about 280px of groups, each with a 13 semibold heading
  (`Installation`, `Marketplace`, `Categories`, `Resources`). Inside are label/value pairs in two
  columns (label gray 12, value 12), category chips, and external links with ↗. Use it for
  Developer, Launched, Pricing model, Languages, Built for Shopify, and links to the App Store
  listing.
- **Pricing plans (Upwork / Semrush):** one compact bordered card. Plans are radio rows with the
  price right-aligned (`30 minutes … $30`). For apps, list the plans as rows
  (`Free · $0`, `Pro · $29/mo`) with a "Prices from the Shopify App Store, as of 12 Nov 2026"
  footnote. Don't use a marketing pricing grid.
- **Tabs (Snowflake / VS Code):** `Overview · Stores using it · Where it appears · Reviews ·
  Alternatives` as 13px text tabs with a 2px underline on the active tab and a hairline under the
  whole row. Put counts in the tab labels ("Stores using it 412").
- **"Used by" section:** a grid of store tiles (§1) under a heading with the count and a
  `See all 412 →` link. For apps, add "Where the widget appears": section crops of the product
  page with the widget area outlined in the accent colour.

## 5. Comparison page (X vs Y)

References
- [Whereby vs Twilio: serif heading, 3-column zebra table](https://mobbin.com/sites/sections/22732bba-1e9b-4720-aba4-2919031c7b2e?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Notion vs Monday.com: narrow check/cross table on a warm card](https://mobbin.com/sites/sections/1a7f4a2b-faa2-4d80-8a59-6561565093bf?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [folk vs Airtable: two real screenshots side by side, captioned](https://mobbin.com/sites/sections/da0522ea-4f29-42eb-a4c9-d1489358be78?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Notion vs Evernote: "Pricing, side-by-side" twin cards](https://mobbin.com/sites/sections/ec9a6256-e9fa-4113-b309-feea5e120fbe?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Ploy: today vs with-us two-column rows with a centre arrow](https://mobbin.com/sites/sections/9138eef2-4217-4b65-bdac-b9f7909c6d40?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Superpower: rounded zebra rows with brand header](https://mobbin.com/sites/sections/9baa0d2c-5a70-4013-bfa7-75bcb19f9f79?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Page structure:** a title, then two summary cards side by side, then a visual comparison,
  then a fact table, then a verdict, then "Alternatives to each".
- **Twin summary cards (Notion vs Evernote).** Two equal cards, each with a logo, name and
  one-line description in the top half, and the price plus a check list in a lower half on a
  warm-gray tint. Keep both cards identical in structure. Neither one gets a "winner" glow, since
  we are neutral.
- **Visual comparison first (folk).** Two screenshots at the same scale, each with a bold 14px
  label above ("Dawn on Allbirds") and a 14px gray caption below. For themes and stores, show the
  same page type and section type side by side, e.g. both product pages, with a page-type
  switcher.
- **Fact table (Whereby).** Row labels in a bold 13px first column (~28% wide), two equal value
  columns headed by the product names at 18px, light warm-gray zebra fill on alternate rows, a 1px
  vertical hairline between value columns, `—` for N/A and a thin ✓. Superpower's version, with
  8px-radius row backgrounds instead of full-bleed stripes, looks calmer. Use it.
- **Narrow tables are calmer (Notion).** ~620px max width, centred, on a #F7F6F3-style warm card,
  with right-aligned logo + name headers. Draw ✓ in ink and × in light gray so the eye goes to
  the ticks.
- **Serif section heading** ("Why switch to Whereby?") in Newsreader, the only flourish. Avoid
  Jasper-style colored column fills (green/purple). That is the AI-template look.

## 6. Website / company profile with tabs (store detail)

References
- [Wellfound: company profile, tabs with counts + "About" facts card](https://mobbin.com/screens/0ba4fd29-36e3-4308-8209-94a82a722150?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Plane: customer record, right Properties panel](https://mobbin.com/screens/2baeae80-10a5-43cc-b18a-4db4fee5b1ff?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Cofounder: "Stack" list (Domain / Email / Payment / Hosting)](https://mobbin.com/screens/5100d7f8-e1f5-4661-a526-53451e8d5587?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Juicebox: company modal with logo chips for related companies](https://mobbin.com/screens/7c79e48e-5b01-41f1-b5b5-e35f0f36fb14?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Contra: big name + domain header, Jobs / About tabs](https://mobbin.com/screens/af5e9c35-9f77-4eed-bc51-3d2ee0dd5934?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Header (Wellfound):** a breadcrumb (`Stores › Apparel › Allbirds`, 12px gray), a 48px square
  logo with a 1px border and 6px radius, the name at 20 semibold, a one-line tagline in gray, and
  small status badges (uppercase 10px with an icon). Actions go top-right: `Share` (text) and
  `+ Save` (outlined).
- **Tabs with counts:** `Overview · Pages · Sections 64 · Apps 18 · Theme · History`. The count
  sits in a small gray chip after the label. Tabs are 13-14px with a 2px ink underline on the
  active tab, over a full-width hairline.
- **Facts card on the right (~280px):** an eyebrow ("ABOUT ALLBIRDS", 11px uppercase gray), then
  stacked label (12 gray) / value (13 ink) pairs: Website with icons, Location, Category, Theme,
  First seen, Last captured. Market and category tags as small gray chips.
- **Tech stack as a list, not a logo wall (Cofounder / Plane).** A gray inset card of rows: the
  label on the left (`Theme`, `Reviews`, `Subscriptions`, `Email`, `Search`), the value on the
  right (app icon 16px + name). Rows ~36px with hairline separators. Plane's two-column label/value
  grid (40/60) works for the same thing on narrow sidebars.
- **Logo chips for related entities (Juicebox):** a favicon plus name in a bordered pill, 28px
  tall, wrapping. Use it for "Also uses" and "Similar stores".
- **Page sections:** a strip of page-type tabs (Home / Collection / Product / Cart), each with a
  desktop/mobile toggle. Below it, the full-page screenshot on the left (sticky, scrollable) and
  the list of tagged sections on the right. Clicking a section scrolls the screenshot to it and
  outlines the slice.
- **Contra-scale name** (~44px) works for top stores if it is set in Newsreader. Keep the domain
  under it as a 14px gray link with a globe icon.

## 7. Long-form editorial (Store Teardowns)

References
- [The New York Times: article header, action row, captioned lead image](https://mobbin.com/screens/e3d0c4c8-4c37-4284-830a-7b0bf238101d?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Julienne: serif title, centred byline meta row](https://mobbin.com/screens/55efafcc-c31a-40fc-941b-20db82a4ea56?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [GetYourGuide: body column + "In this article" TOC + related rail](https://mobbin.com/screens/7771ec75-2458-4381-9cbe-f0cb87d4b027?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Notion: right-edge tick-mark TOC](https://mobbin.com/screens/aedea57f-f35d-4fc7-93f3-0a9b5bed5f42?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Intercom: pull quote between hairlines with attribution](https://mobbin.com/sites/sections/a84a28dc-2c92-4e5e-9ce5-8e1c440a1095?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Bird: stat + quote pairs split by a hairline](https://mobbin.com/sites/sections/16a49355-486c-48d0-b568-93c454aadd77?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **NYT header ratios:** a centred column of ~600px. The headline is serif at ~40px (Newsreader,
  regular or medium, optionally italic). The dek is serif at ~22px, so headline : dek ≈ 1.8 : 1.
  Then the action row between two hairlines: `Listen · 4:41 min` on the left, Share / Save /
  comments on the right. The lead image fills the column, with the caption at 13px gray and the
  credit at 11px lighter on the same line.
- **Byline (Julienne):** a 24px avatar, then `By Sarah L. · Last updated 11/07/25 · 20 recipes`
  at 12-13px gray, centred under the title. Ours: `By … · 12 min read · Updated 14 Nov 2026 ·
  Store captured 10 Nov 2026`.
- **Body width:** about 680px (~68ch) at 18/30 in Instrument Sans or Newsreader. Images can break
  out to ~960px, and full-page screenshots to the container width.
- **TOC:** GetYourGuide uses a ~340px right rail with a bordered "In this article ▾" card plus a
  "Read more" list (52px thumb, date, title, author). Notion uses a near-invisible right-edge
  column of tick marks that expands on hover. Use the tick marks on desktop and the collapsible
  card on mobile.
- **Pull quote (Intercom):** ~26px, a hairline above and below, ~32px vertical padding, and the
  attribution (32px avatar, name 13 semibold, role 13 gray). Set the quote in Newsreader to
  contrast with the sans body.
- **Stat callouts (Bird):** the number at ~44px light weight, a 12px gray label under it, and a
  quote below. Two per row, split by a vertical hairline. Every stat also needs a source line
  (§14).
- **Annotated images:** none of the results show callouts on screenshots, so we have to design
  this one. Recommendation: numbered 20px accent circles placed on the image, matched to a
  numbered list in the caption. Use thin 1px accent boxes for regions, never arrows or drop
  shadows.

## 8. Command palette (Cmd+K) and search results

References
- [Juicebox: grouped results, accent bar on active row, keycap footer](https://mobbin.com/screens/84169c57-5cd6-4495-bb71-93d37266f4c4?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Magnific: Recents + Quick actions with shortcuts, legend footer](https://mobbin.com/screens/e22e26e2-f813-4f1e-beda-43c9ecf26419?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Base44: two-line rows, warm-gray active row, ⌘K hint](https://mobbin.com/screens/675ecfd2-b7fc-4e8d-9078-3eeeaddda7c7?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [komoot: type tabs inside the search dropdown, rich rows](https://mobbin.com/screens/28f9448c-382a-4e1d-a0bc-29dd2229e50c?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Snowflake: query suggestions, then entity rows "Name • Source • Type"](https://mobbin.com/screens/78b760ac-c23b-4865-84de-8ade03e13c02?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Miro: search results page with Owner / Spaces filters](https://mobbin.com/screens/ba42a22e-60cb-49f4-b9c5-595ffeb3fefa?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Size and placement:** ~640px wide, top edge at ~20vh. The backdrop is ~40% dim with a light
  blur (Base44, Mintlify), and the panel has a 12-14px radius and a soft shadow.
- **Input row:** ~52px tall with 16px text, a search icon on the left, and an `esc` keycap on the
  right (Mintlify) or `⌘K` (Base44). Placeholder: "Search stores, themes, apps, sections…".
- **Groups:** an 11px label in tertiary gray (Juicebox uses small caps: ANALYTICS / RESOURCES /
  COMPANIES). Our groups: Stores, Themes, Apps, Sections, Pages, Actions. Show at most 4-5 rows
  per group, then "See all 37 stores ↵".
- **Rows:** ~40px single-line or ~48px two-line. Icon or 24px favicon, name at 14, then the meta
  inline in gray ("Juicebox  juicebox.com.au") or as a second line ("Favorite app"). The active
  row gets a warm-gray fill with 8px radius (Base44). Juicebox also adds a 2px left accent bar,
  and we should too. Right side: `↵` on the active row, otherwise a type label or shortcut keycaps
  (`⌘⇧S`).
- **Footer legend (Magnific):** a ~32px bar with a top hairline:
  `↑↓ Navigate · ↵ Select · esc Close · ⇧↵ Open in new tab`. 11px with 18px keycaps, and the
  result count on the right ("14 results").
- **Empty query state:** Recents first, then Quick actions with shortcuts (Magnific). Ours:
  recent searches, then "Jump to: Top stores (G S), Themes (G T), Apps (G A), Sections (G E)".
- **Scoping inside search (komoot):** small chips at the top of the result list
  (`Top results · Stores · Themes · Apps · Sections`). Tab cycles through them (Juicebox's legend
  shows `Tab to jump sections`).
- **Full results page (Miro):** a page title ("Search 'sleep'"), a full-width gray-fill input, and
  filter dropdown pills under it. Rows have a 28px thumbnail, the title with the **matched term in
  bold**, and a gray path line (`Store · Product page · Reviews section`). Image results switch
  to the §1 grid.

## 9. Home page of an image-first library

References
- [Mobbin: "Find what works. Design what's next." plain hero](https://mobbin.com/sites/sections/9d77f3c9-1e7c-4914-bc09-af8a197d9d97?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Save.design: no hero, title line then the grid](https://mobbin.com/sites/sections/217b032c-c580-48d8-a26f-7e9224e11737?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Cosmos: light serif headline among real images](https://mobbin.com/sites/sections/9d49e7c0-4d8a-491e-90ab-5ed7e7fd76cd?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Webflow Libraries: split hero with a wall of real screenshots bleeding off-edge](https://mobbin.com/sites/sections/c41988ec-d36b-479e-8df2-7766d176b8f2?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mobbin: customer stories, underline tabs + large rounded image card](https://mobbin.com/sites/sections/cbb0374c-de2c-498d-826b-4d86e2fefd5e?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Lattice Library: featured + spotlight list](https://mobbin.com/sites/sections/a783716a-c618-42a6-a171-0f459383cab6?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Prove the promise with the product, not a hero graphic.** Save.design opens with only
  "The website inspo library" (14px) and "Curated, updated daily." (12px gray) top-left, a
  Websites/Elements segmented control, and then real screenshots fill the fold. Every tile has a
  monospace 11px domain caption and a ↗. A `Save` button appears top-right on hover.
- **If there is a headline, make it short, specific and true (Mobbin).** Two lines in bold at
  ~60px, -2% tracking, 1.05 leading. The sub-line is two lines at 15px gray with a concrete
  origin and a live number: "Mobbin started in 2018 as Jiho's Dropbox folder of screenshots. It's
  still that folder at heart, just 621,500 screens bigger." CTAs: a black pill plus a light-gray
  pill with →. Ours: "Real Shopify stores, page by page." with "12,480 pages from 1,040 stores,
  captured 10 Nov 2026."
- **Serif variant (Cosmos):** a light-weight serif headline centred among real images at varied
  sizes. With Newsreader at ~64px over a quiet scatter of real store crops, this is the one
  "brand moment" we allow. No gradients.
- **Split variant (Webflow):** headline on the left, and on the right a 3×3 wall of real page
  thumbnails cropped by the viewport edge. Shows scale. Use real store screenshots only.
- **Below the fold:** underline category tabs (`Featured · Apparel · Beauty · Home · Food`), then a
  large rounded (16px) featured teardown card with the headline over the image (Mobbin customer
  stories), then a row of shelves: "New this week", "Top themes", "Most-installed apps", and
  "Sections: hero / reviews / footer".
- **Featured + spotlight (Lattice):** one big card on the left and 4 compact rows on the right
  (thumb, title, 2 type tags), each half on a soft warm card. Good for Teardowns on the home page.

## 10. Pricing, sign-in, empty states

References
- [Aside: cardless 3-column pricing split by hairlines](https://mobbin.com/sites/sections/de9e1a65-59c9-41f0-8c73-01df009482e1?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Oku: serif "Premium Membership", quiet tinted plans, monthly/yearly toggle](https://mobbin.com/sites/sections/28f6f7f1-03fd-4541-a720-3d3ab51e9c43?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Searchable: warm off-white sign-in with serif headline](https://mobbin.com/screens/f9fb2da0-0199-4208-b478-2837aa62494c?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Lightfield: left-aligned narrow sign-in column](https://mobbin.com/screens/c3792edb-15b0-4a55-8dc0-a4892ba3469a?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mobbin: Saved empty state "Gather your inspiration"](https://mobbin.com/screens/f68b3864-e437-43b2-88b7-43a13f634513?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Relume: empty state as a warm-gray panel](https://mobbin.com/screens/06b0869d-0597-4f57-a52e-8248ef1c19f6?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Pricing without cards (Aside).** A 2-line headline centred at ~44px, a gray sub-line, and a
  segmented `Monthly | Yearly (-20%)` control. Columns are split by 1px vertical hairlines
  instead of boxes. Each column has the plan name in bold followed by its descriptor in gray on
  the same line ("**Pro** Best for agencies"), the price at ~56px regular with `/month` at 12px
  gray, and an "Everything in Free" row with a ⊕ glyph before the checks. CTAs are bottom-aligned
  full-width bars: Free is gray fill, Pro is ink or accent. Two plans (Free / Pro), maybe a Team
  column later.
- **Serif title (Oku: "Premium Membership").** Newsreader for the page title only. Oku's tints
  (sage, lilac) are pleasant, but we keep one accent: the Pro column gets a 1px accent top rule,
  not a coloured card.
- **Sign-in (Searchable):** warm off-white background, a centred Newsreader headline ~40px
  ("Sign in to save boards."), and a 12px gray terms line right under it. Then white outlined
  `Continue with Google` and `Continue with email link` (40px, 8px radius), a hairline, and the
  email field + primary button. "Don't have an account? Sign up" sits at the bottom of the
  viewport. Lightfield's version is a left-aligned ~380px column with a 32px logo tile: also good.
- **Empty saved boards (Mobbin):** "Saved" page title at 28 bold, Mobile/Web segmented control, an
  `Upload` button. Centred: an illustration made of 3 fanned gray placeholder screen cards (no
  people, no colour), "Gather your inspiration" at 15 semibold, two gray lines of help text, and a
  black pill `Create collection`. Ours: three fanned gray store-page silhouettes, "No boards yet",
  "Save stores, pages and sections to compare them later.", `Browse top stores`.
- **Empty state inside a page (Relume):** a full-width warm-gray panel (#ECEAE6-ish) with 12px
  radius, a centred 15 semibold line, one gray line, and an outlined small button. Use for empty
  tabs and filters with zero results. Always offer "Clear filters".

## 11. Legal / static pages and request forms

References
- [Miro Terms: left numbered TOC, dates, summary callout](https://mobbin.com/sites/sections/47c3e6ab-e2e1-401e-baa3-79e8954e5919?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Customer.io: legal-doc switcher rail + numbered headings](https://mobbin.com/sites/sections/d59e69ed-b18f-407b-a743-d5503ec8cf1f?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [MasterClass Privacy: TOC + "Make a Privacy Request" button](https://mobbin.com/screens/59ce80a7-3445-40cc-a1d5-5f32d8125987?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Mailchimp: serif question heading, labels above, helper + "Recommended"](https://mobbin.com/screens/b41383e1-c348-445c-9e71-c40549f848dc?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Savee: contact form with live FAQ suggestions alongside](https://mobbin.com/screens/731e0a2c-61e7-406d-b18d-2216ef37fc50?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Deel: request form, help cards, character counters, sticky action bar](https://mobbin.com/screens/19493748-66f8-444e-a27a-986a39629c1c?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Legal layout (Miro):** a left TOC ~280px with a "CONTENTS" eyebrow (11px uppercase), numbered
  items at 13px gray, and the active item in ink on a light tint with 6px radius, sticky. A
  vertical hairline separates it from the content. The content has the title at 36-40 bold (or
  Newsreader), then two gray date lines ("Published 1 Nov 2026 · Effective 1 Dec 2026"), then a
  plain-language summary in a gray rounded callout before the legal text. Cap the content at
  ~680px; Miro's ~750px is too wide.
- **Doc switcher (Customer.io):** a left rail that lists all legal docs (Terms, Privacy, Cookies,
  Opt-out, Takedown) with the current one in accent. Inside the doc, a TOC of numbered section
  headings ("1. Access to Services"). Combine the two: doc links on top, current doc's sections
  nested under them.
- **Link the opt-out form from the legal pages (MasterClass).** MasterClass keeps a "Make a
  Privacy Request" primary button top-right on its privacy page. We should put `Request removal`
  on Privacy, Terms and every store page footer.
- **Form style (Mailchimp):** a Newsreader question heading ("Remove a store from [SITE_NAME]"),
  13 semibold labels above inputs, 40-44px inputs with 1px border and 8px radius, gray helper text
  under fields ("We'll only use this to confirm the request"), and "Optional" right-aligned on the
  label row. Consent checkbox with 13px gray text. A single primary button, left-aligned.
- **Context panel (Savee / Deel):** a right column (~320px) with a "What happens next" card
  (3 numbered steps + expected timeline) and a "Need help?" card. Savee surfaces matching FAQ
  answers live while the user types. Nice to have later.
- **Long text fields (Deel):** `0 / 2000` character counters right-aligned under textareas.
  Required fields marked with `*`.
- **Success state:** replace the form with a confirmation block that shows a reference number,
  the store domain submitted and the expected response time. Do not just show a toast.

## 12. Admin tables and review queues

References
- [Circle: Moderation with Inbox / Approved / Rejected counts](https://mobbin.com/screens/6c0687e1-5bf7-47b8-8e01-1d7a57f99b89?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [StackAI: Pending / Approved / Rejected segmented control, inline ✓ ×](https://mobbin.com/screens/3ee3b3f3-ee96-480d-bb21-17369bed1b03?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [AirOps: analysis callout + Decline all / Accept all + per-row ✓ ×](https://mobbin.com/screens/6642909e-6268-45ee-8028-72f19c646023?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Klaviyo: reviews queue, left filter rail, status pills](https://mobbin.com/screens/8dd26845-c730-4da6-b953-570e5025ed49?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Aboard: approvals table, Pending / Approved pills](https://mobbin.com/screens/9ce069a2-2cbe-4c94-a7f5-b57050e50ca0?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Deel: filter-chip row above a dense table with row actions](https://mobbin.com/screens/69aff800-d27f-4b29-b4dc-ee3d1e98579e?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Queue tabs with counts:** `Pending (12) | Approved (340) | Rejected (8)` as a segmented
  control (StackAI) or text tabs with a gray count (Circle: `Inbox 1 · Approved 0 · Rejected 0`).
- **Table:** 11-12px uppercase or 12px medium headers in gray, ~44px rows, hairline separators,
  no zebra. Columns for removal requests: Store, Requested by, Reason, Received, Status, Actions.
  Row actions are icon buttons on the far right (× outlined, ✓ filled ink, 28px). Both StackAI
  and AirOps do this.
- **Status pills (Aboard / Klaviyo):** 12px text with a 6px dot or icon on a tinted background
  (Pending amber, Approved green, Rejected red, Published neutral). These are the only places
  semantic colours appear.
- **Bulk actions (AirOps):** a summary callout on top (gray panel: what this batch is), then
  `Decline all` (gray) and `Accept all` (ink) on the right above the table. A toast with an undo
  progress bar confirms ("1 item declined").
- **Filters (Deel / Klaviyo):** a horizontal row of dropdown pills (`Status ▾ Reason ▾ Date ▾`)
  with search on the left, or a left rail with radio statuses for queues where the same reviewer
  works for hours.
- **Pagination (StackAI):** `‹ Prev  Next ›` on the left, and on the right a rows-per-page
  segmented control (`10 | 20 | 30`). Show "Showing 1-20 of 312" (Circle).
- **Keyboard:** J/K to move, A approve, R reject, Enter to open detail. Show the shortcuts in a
  footer legend, like the command palette.

## 13. Mobile navigation and filter bottom sheets (iOS references)

References
- [Insight Timer: filter sheet, serif group titles, "Show 169 results"](https://mobbin.com/screens/f532c0e9-58ed-44c0-9d6e-572b20aeba58?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [eBay: "Filters · 302 results", Selected chips, collapsible groups](https://mobbin.com/screens/53a7dde4-d8f7-49d1-8652-5be4d7b5b321?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Vivino: chips with counts "United States (135)", "Show 151 wines"](https://mobbin.com/screens/0fae75cc-f2e2-4a60-81f0-5ecacb1d2947?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [DoorDash: single-facet sheet, outlined selected chips](https://mobbin.com/screens/510bb65b-ddc8-4690-a482-2d442aa25dbf?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Insight Timer: menu with search on top, grouped rows with chevrons](https://mobbin.com/screens/ea06f0d0-bc54-4644-a560-af149836fef5?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Shopify: grouped collapsible menu + floating close](https://mobbin.com/screens/fcfd23ed-f847-402d-ab2f-81f826fd847e?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Sheet anatomy:** a 36×4 grabber, 20-24px top radius, and a header with the title on the left
  and ✕ on the right. eBay puts a gray result count under the title ("302 results"). The body
  scrolls between a fixed header and a fixed footer.
- **Footer:** `Clear all` as a text link on the left and a primary `Show 169 results` on the right
  (Insight Timer, Tripadvisor, Vivino). The live count in the button is the most important
  detail. It updates as chips toggle, so users never apply a filter that returns nothing.
- **Chips:** 36-40px tall, full radius, 1px border. Selected = filled ink with white text
  (Insight Timer). Counts go in the chip where useful (`Dawn (214)`, Vivino). Put a "Selected (2)"
  row of removable chips at the top (eBay).
- **Groups:** a 16-17px semibold title (Insight Timer uses a serif here, which suits Newsreader
  if used sparingly) and hairline dividers between groups. Long groups collapse with a chevron and
  "Show all" (eBay, Vivino).
- **On desktop the same filters are dropdown pills (§1).** On mobile, a single `Filters (2)` pill
  plus a horizontally scrolling row of the 3-4 most-used chips opens this sheet.
- **Mobile menu (Insight Timer):** a full-height sheet with ✕ top-left and a search field next to
  it, which opens Cmd+K. Rows are 17px semibold, ~48px tall, with a light chevron. Group labels are
  small gray ("Browse", "Library", "Company"). Shopify's admin menu has collapsible groups and a
  floating bottom cluster (settings + close), so the thumb can reach the actions. Keep the account
  and "Request removal" links at the bottom.

## 14. Footer and data/stat strips with sources

References
- [Mintlify: five link columns, status pill, theme toggle](https://mobbin.com/sites/sections/228cae97-ec03-499c-840f-9005c4c2aa93?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [folk: footer with a "Compare" column ("Switch from Airtable")](https://mobbin.com/sites/sections/6cdb722a-cc4b-4bb1-b145-fda8d84b88f1?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Linear: dark compact footer, legal row](https://mobbin.com/sites/sections/4643c95a-5a5b-46cf-999c-bb3f328fd281?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Amplemarket: light-weight large numerals on warm off-white](https://mobbin.com/sites/sections/7630befa-a79e-459c-bacc-77d9ee066b5b?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Dropbox: number + bold label + gray explanation, 3 columns](https://mobbin.com/sites/sections/9ec10d90-45a7-4662-81ac-36653ec66c06?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
- [Basecamp: live dated number "2,396 organizations signed up last week"](https://mobbin.com/screens/29ef36ec-0911-43ff-977c-cf9ccc4cb6c9?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)

Takeaways
- **Footer (Mintlify):** logo in column 1, then 4-5 link columns. Column headings are 12-13px in
  tertiary gray, not bold, and links are 13-14px in ink with ~12px vertical rhythm. A small status
  pill sits under the logo ("● All systems normal"; ours: "● Last capture: 10 Nov 2026"). Bottom
  row: a light/dark/system theme toggle on the left and social icons on the right, with a hairline
  above.
- **SEO link columns (folk):** a "Compare" column of real comparison links ("Switch from
  Airtable…"). Ours: "Compare" (top /compare pages), "Alternatives", "Themes", "Apps by category".
  These pages are part of the product, so linking them in the footer is fine.
- **Legal row:** `Privacy · Terms · Request removal · Cookies`, 12px gray, plus the copyright with
  `SITE_NAME`. Linear keeps it to three words. Do the same.
- **Stat style (Amplemarket):** numbers at ~40px **light** weight (300) in ink, a 12px gray label
  under them, centred, generous spacing, no icons. This looks more refined than Deel's bold
  numbers with icons.
- **Stat with explanation (Dropbox):** the number at 20px semibold, a bold 14px label, then a
  2-line gray explanation. Use on data-heavy pages.
- **Every number gets a source and date.** None of the references do this, so it can set us
  apart. Format: under the strip, one line at 12px tertiary gray: "Source: [SITE_NAME] crawl of
  1,040 stores · as of 10 Nov 2026 · Methodology →". On individual stats, add a dotted underline
  on the label with a tooltip showing source + date. Basecamp's "last week" framing proves that
  a dated number reads as more trustworthy than a bare "10,000+".

---

## Patterns to adopt for our site

1. **One tile system.** A warm-gray frame (~16px radius, no border) with the screenshot inset and
   centred. The caption goes below the tile: favicon 20px + store name 14/20 medium + one gray
   meta line (theme · category). The frame absorbs any aspect ratio (desktop 16:10, mobile
   9:19.5, section strips ~2.4:1). 3 columns at 1440 for desktop pages, 5-6 for mobile screens,
   1 at 390 (2 for mobile screens).
2. **Hover = dark scrim + two bottom pills (`Save`, `Open`).** Selection = 2px accent outline + check
   circle. Multi-select brings up a floating dark pill bar (`3 selected | Clear | Save to board`).
3. **Filters are outlined dropdown pills.** Applied values become dark-outlined chips with ⊗. The
   result count sits top-right ("Showing 1,204 sections"), and sort is a separate ⇅ icon menu.
   A left rail only for the Sections library.
4. **Type tabs carry counts** (`Stores 1,040 · Themes 86 · Apps 412 · Sections 9,860`) in tertiary
   gray.
5. **A capture-date selector** (`Captured Nov 2026 ▾`), like Mobbin's version filter, so stores
   can be shown over time and every screenshot is dated.
6. **Detail pages use a two-column header with a facts strip** (value over label, 6 cells, hairlines
   above and below) and a ~280px facts sidebar of label/value pairs. The tech stack is a list
   of rows (label → app icon + name), not a logo wall.
7. **Lightbox:** scrollable image canvas, fixed 340px right panel (domain ↗, page type, device,
   theme, apps, palette, Save to board). ← → between screenshots, `1 / 24` counter, "More from
   this store" strip.
8. **Apps index = dense ranked rows** (monospace rank, 32px icon, name, tagline, right-aligned
   numbers in tabular figures). Themes and stores = screenshot tiles.
9. **Comparisons:** twin summary cards, then same-scale side-by-side screenshots with captions, then
   a narrow (~620px) fact table with rounded zebra rows, ✓ in ink and × in light gray.
10. **Command palette:** ~640px wide at 20vh, grouped results (Stores/Themes/Apps/Sections/Pages),
    two-line rows, warm-gray active row + 2px accent bar, scope chips, keycap legend footer with
    result count.
11. **Newsreader appears in a few places only:** home headline, Teardown titles and pull quotes,
    theme names, pricing/legal/sign-in page titles, comparison section headings. All UI stays in
    Instrument Sans.
12. **Home opens with the library itself.** A short true headline with a live dated number, then
    real store screenshots within the first viewport.
13. **Mobile filters = bottom sheet** with "Selected" chips, collapsible groups, chips with counts,
    and a sticky `Clear all` / `Show 214 results` footer.
14. **Source + "as of" line under every stat strip and table**, plus dotted-underline tooltips on
    individual numbers.
15. **"Request removal" is easy to find:** footer legal row, every store page, the privacy page
    header button and the mobile menu.

## Patterns to avoid

1. Coloured comparison columns (Jasper's green/purple) and "winner" highlighting. We compare
   neutrally.
2. Gradient or illustrated hero banners (Deel's app-store banner, monday-style mock UIs). Show real
   store screenshots or nothing.
3. Bold multi-coloured stat numbers with icons (Jasper, Deel, Kalstore). Use one ink colour, light
   weight, and a source line.
4. Icon-in-circle empty states and cute illustrations (Pinterest's corkboard, Klarna's 3D tiles).
   Use gray placeholder silhouettes of our own content, as Mobbin does.
5. Card-heavy directories with three lines of marketing copy per logo (Gorgias, Mailchimp). Apps
   get dense rows. Never put a "Connect/Install" button on our site, since we are not the app
   store.
6. Purple primary buttons, glassy blurred panels and gradient-text headlines (Dub's
   "Straightforward,"). One accent colour only, and use it for state, not decoration.
7. Wide legal text columns (Miro ~750px, Vimeo boxed page). Cap at ~680px with a sticky TOC.
8. Masonry with mixed tile heights for store pages. It breaks scanning by page type. Keep masonry
   (if anywhere) for the Sections library only, and even there prefer the framed fixed-aspect tile.
9. Hidden or icon-only primary actions in the lightbox. Save must always be visible as a labelled
   button, as in Savee's `Saved ▾`.
10. Sticky promo bars and chat bubbles (Webflow "Made in Webflow", Intercom launchers) covering the
    corner of image grids.

---

---

**Your Mobbin AI usage is high this month**

Usage is unlimited during beta. If your usage stays at this level, you may need to purchase more credits once limits take effect. [View usage and plan options](https://mobbin.com/settings/billing-and-usage?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp)
