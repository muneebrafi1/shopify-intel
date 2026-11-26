---
slug: thursdayboots
store: thursdayboots.com
title: 'Thursday Boot Co.: Atlantic 13.4.0 with twelve apps and nine tracking tags'
dek: What our 17 Nov 2026 scan detected on thursdayboots.com — dual returns tools, dual back-in-stock apps, Global-e and a heavy ad-measurement layer.
published_at: '2026-11-26'
is_sample: false
notes:
  - n: 1
    page_type: home
    device: desktop
    section_type: header
    title: 'Cross-border storefront header with Global-e'
    body: thursdayboots.com runs Global-e CrossBorder (31 of 930 scanned stores) on top of Atlantic 13.4.0 ($300 by Pixel Union), adding international currency and shipping localization at the top level.
  - n: 2
    page_type: home
    device: desktop
    section_type: slideshow
    title: 'Editorial hero slideshow on Atlantic'
    body: Atlantic opens with a full-width slideshow followed by stacked campaign hero bands and customer review proof further down the home page.
  - n: 3
    page_type: cart
    device: desktop
    section_type: cart-items
    title: 'Returns stack: Redo and Loop Returns both detected'
    body: Both Redo (43 of 930 stores) and Loop Returns & Exchanges (21 of 930) were detected on thursdayboots.com, making it a live example of overlapping Shipping & Returns scripts.
  - n: 4
    page_type: home
    device: desktop
    section_type: footer
    title: 'Nine tracking tags anchored via Google Tag Manager'
    body: Alongside Google Tag Manager, the scan recorded GA4, Google Ads, Meta Pixel, Microsoft UET, Pinterest Tag, Heap, LiveIntent and Northbeam.
---

> **Note.** Written from our 17 Nov 2026 scan of 930 Shopify stores (theme, detected apps, tracking tags) and Shopify App Store / Theme Store records. No revenue, traffic or conversion estimates are used.

## Theme

thursdayboots.com runs [Atlantic](/themes/atlantic) **13.4.0**, a $300 theme by Pixel Union with five presets (Atlantic, Plush, Cotton, Atrium and Parfum). Atlantic appeared on 5 of the 930 stores in the scan (rank 16), and `thursdayboots.com` is the only one of those 5 where a version number was observed.

## Apps

Twelve apps were identified on `thursdayboots.com`, with zero unresolved detections:

- **Email & SMS:** [Klaviyo](/apps/klaviyo), [Hulk Contact Form Builder](/apps/form-builder-by-hulkapps) and [Pop-Ups & Spotlight by Justuno](/apps/justuno)
- **Wishlist & Back in Stock:** [AMP Back in Stock](/apps/amp-back-in-stock) and [Amp Back in Stock & Preorder +](/apps/backinstock)
- **Shipping & Returns:** [Redo](/apps/redo) and [Loop Returns & Exchanges](/apps/loop-returns)
- **Currency & Translation:** [Global-e CrossBorder](/apps/global-e-crossborder)
- **Product Options & Sizing:** [Hulk Product Options, Variants](/apps/product-options-by-hulkapps-1)
- **Chat & Support:** [Zendesk](/apps/zendesk)
- **Analytics:** [Blotout EdgeTag](/apps/edgetag)
- **Privacy & Security:** [TrueVault Polaris](/apps/truevault-polaris)

> Twelve apps with two notable category pairs: Redo alongside Loop Returns, and two AMP back-in-stock scripts.

Notice the absence of a standalone App Store reviews plugin in the detections, even though the home page includes a reviews section: that points to native or custom-rendered review blocks rather than a third-party widget like Judge.me or Yotpo.

## Tracking

Nine tracking tags were detected — one of the largest measurement footprints among curated stores:

- **Core tags:** Google Tag Manager, Google Analytics 4
- **Paid social & search:** Google Ads, Meta Pixel, Microsoft UET, Pinterest Tag, LiveIntent
- **Attribution & product analytics:** Northbeam, Heap (plus Blotout EdgeTag among apps)

## What stands out in this stack

1. **Redo and Loop Returns side by side:** See [Loop Returns vs Redo](/compare/loop-returns-vs-redo) for how the two compare across the wider 930-store scan (Redo on 43 stores vs Loop on 21).
2. **Zendesk over Gorgias:** Among curated stores, most run [Gorgias](/apps/helpdesk) (76 of 930); Thursday Boot Co. uses [Zendesk](/apps/zendesk) (7 of 930; compare in [Gorgias vs Zendesk](/compare/helpdesk-vs-zendesk)).
3. **Server-side and privacy tooling:** Detecting [Blotout EdgeTag](/apps/edgetag) (4 of 930) alongside [TrueVault Polaris](/apps/truevault-polaris) (3 of 930) reflects heavier compliance and first-party event plumbing than typical mid-market storefronts.
