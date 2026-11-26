---
slug: fctrylab
store: fctrylab.com
title: 'FCTRY LAb: a custom theme with nine apps doing the selling'
dek: 'What our 26 Nov 2026 crawl and captures show on fctrylab.com, a footwear brand on a custom theme where reviews, upsells and an Instagram feed each get their own band.'
published_at: '2026-11-26'
is_sample: false
notes:
  - n: 1
    page_type: home
    device: desktop
    section_type: slideshow
    title: 'A slideshow, then promo bars between the bands'
    body: 'The home page opens with an announcement bar, the header and a slideshow. Two more announcement-style strips split the page further down, between the featured collection and the rich-text blocks.'
  - n: 2
    page_type: home
    device: desktop
    section_type: ugc-gallery
    title: 'An Instagram feed above the footer'
    body: 'Instafeed renders the gallery just before the footer, after a blog row and a newsletter sign-up. It is the same closing sequence on the collection page.'
  - n: 3
    page_type: product
    device: desktop
    section_type: reviews
    title: 'Three upsell rows before the reviews'
    body: 'Under the buy box come a promo strip, an upsell row, a video and two more upsell rows; Loox reviews follow, then an FAQ. Loox also shows its star rating inside the buy box.'
  - n: 4
    page_type: collection
    device: mobile
    section_type: hero
    title: 'A banner above the grid on collections'
    body: 'Collection pages put a hero banner above the product grid on both devices, then a newsletter, a rich-text block and the Instagram feed.'
---

> **How this was written.** From our 26 November 2026 crawl and captures (home, collection and
> product pages, desktop and mobile) of fctrylab.com. Apps are matched to sections from the page
> code; where an app could render in more than one place, we say so. No revenue or traffic
> estimates are used. Store counts are out of the 993 Shopify stores in our data.

## Theme

fctrylab.com reports its theme as "SimplSo" (version 1.0.1), which is not a theme from the
Shopify Theme Store, so we treat it as custom. The page structure still follows the familiar
Online Store 2.0 pattern: announcement bar, header, stacked sections, footer.

## Apps

Our crawl identified nine apps on `fctrylab.com`:

- **Email, SMS and push:** [Klaviyo](/apps/klaviyo) and [Brevo PushOwl](/apps/pushowl)
- **Reviews:** [Loox](/apps/loox)
- **Upsell and promotions:** [Hextom](/apps/free-shipping-bar)
- **Page building:** [PageFly](/apps/pagefly)
- **Social proof:** [Instafeed](/apps/instafeed)
- **Wishlist:** [Swish](/apps/wishlist-king)
- **Returns:** [Redo](/apps/redo)
- **Testing and personalisation:** [Black Crow AI](/apps/black-crow-ai)

## What stands out

1. **The product page is long.** The desktop product capture runs to our 14,000 px limit:
   three upsell rows, a video, reviews, an FAQ, a newsletter and the Instagram feed all sit
   below the buy box.
2. **Black Crow AI is rare.** It was detected on 10 of the 993 stores, against Klaviyo's 422.
3. **One page builder, one custom theme.** PageFly is detected alongside the custom theme, so
   some of these sections may be built in PageFly rather than in theme code. We can't tell
   which ones from the outside.

## Open questions

1. Which sections PageFly builds and which come from the theme.
2. Whether the three upsell rows are filled by Hextom or by the theme's own recommendations.
