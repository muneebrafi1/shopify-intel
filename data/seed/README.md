# Seed data

Exported on 2026-11-17 by `tools/export_seed.py` from the StorePeek project data (Chrome extension
detection DB, a scan of 930 Shopify stores on 17 Nov 2026 using pre-v7 detection rules, and cached
Shopify App Store listings). These are **inputs** for the base build — map them into the real schema
with a seed script. No secrets; affiliate URLs are public referral links.

| File | What |
|---|---|
| `apps.json` | 50 most-detected apps with App Store data (name, developer, rating, reviews, plans, features, icon) + scan share + co-installed apps + affiliate link if any |
| `apps-extra.json` | Lighter records for other apps detected on the seed stores, so every store→app link resolves |
| `themes.json` | 20 most-seen themes: vendor, price, Theme Store id, official URL, affiliate link if any, scan count |
| `stores.json` | 20 curated stores (best example per theme: most detected apps, then Tranco popularity rank). Theme + version, detected apps, pixels, currency, detection date |
| `detections-930.json` | All 930 scanned Shopify stores with theme + app slugs — use to show richer "used by N stores" lists and counts |
| `affiliate-links.json` | Affiliate links (apps and themes), incl. Shoffi and FoxEcom programs |
| `affiliate-programs.json` | Program status (approved / pending / no program) |
| `categories.json` | App categories present in `apps.json` |

Caveats
- **No screenshots exist yet.** Use tasteful placeholders that show the intended layout (a capture
  pipeline comes later). Real screenshots will land in R2.
- Scan store lists came from Theme Store example lists, so theme shares are biased, not market share.
- `confidence` is null in this older scan.
- No revenue or traffic data — and we never invent it.
