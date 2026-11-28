---
slug: fishwife
store: eatfishwife.com
title: 'Fishwife: thirteen apps on Blockshop, four of them for email and SMS'
dek: What our 17 Nov 2026 scan found on eatfishwife.com (Blockshop 6.6.0, four email and SMS tools, two testing apps) and one attribution made by category alone.
published_at: '2026-11-17'
is_sample: true
notes:
  - n: 1
    page_type: home
    device: desktop
    section_type: trust-badges
    title: 'A short home page with a trust strip'
    body: 'The home page is announcement bar, header, hero, a trust-badge strip and a press logo list before the footer. None of the four email and SMS apps (Klaviyo, Alia, Postscript, Retention.com) renders an on-page block in the capture, so signup most likely happens in a popup, which we do not slice.'
  - n: 2
    page_type: product
    device: desktop
    section_type: reviews
    title: 'Okendo renders the reviews'
    body: 'The page code ties the product reviews block to Okendo (48 of 930 stores), and its star rating also sits in the buy box. So on this store Okendo works as the reviews app, not only for loyalty.'
  - n: 3
    page_type: product
    device: desktop
    section_type: buy-box
    title: 'Pay later, in the buy box: Afterpay'
    body: Afterpay On-Site Messaging was detected (18 of 930 stores). Buy-now-pay-later messaging usually sits under the price, so the buy box is attributed to it.
---

> **How this was written.** From our scan of 17 November 2026 and our captures of 25 November
> 2026 (home, collection and product pages, desktop and mobile) of eatfishwife.com. Apps are matched
> to sections from the page code; where an app could render in more than one place, we say so.

## Theme

eatfishwife.com runs [Blockshop](/themes/blockshop) **6.6.0**, a paid theme by Troop Themes, listed
at $420 on the Shopify Theme Store. Blockshop was detected on 6 of the 930 stores in the same scan;
eatfishwife.com is the only one of the six where the scan also read a version number.

## Apps

The scan detected thirteen apps, the most of any curated store (tied with LSKD). Grouped by
category:

- **Email & SMS:** [Klaviyo](/apps/klaviyo), [Alia](/apps/alia), Postscript SMS Marketing and
  Retention.com
- **Loyalty & Rewards:** [Okendo](/apps/okendo-reviews) and Fondue CashBack Promotions
- **Testing & Personalization:** [Intelligems](/apps/intelligems) and Black Crow AI
- **Affiliate & Referral:** ShopMy Creator Affiliates and Friendbuy
- **Payments & BNPL:** Afterpay On-Site Messaging
- **Cart & Checkout:** Wholesale Gorilla B2B Tools
- **Privacy & Security:** NoFraud

Five of the thirteen have no section of their own: the testing, affiliate and fraud tools work
around the page rather than adding a block to it.

> Thirteen apps, and the biggest group is email and SMS: four tools for one inbox.

## Tracking

Two tracking tags were detected: **Google Analytics 4** and **Google Tag Manager**.

## What to learn from it

1. How a food brand's stack is weighted. Four of thirteen apps are email and SMS, two are
   affiliate and referral tools and two run tests, against one app for the product page itself.
2. That an app count says little about the page. Only four of the thirteen are attributed to a
   section in the capture.
3. Why some attributions are labelled guesses. The cart's shipping bar is attributed to a wholesale
   app by category alone; we do not capture cart pages, so it stays a labelled guess.

## Open questions

1. Which of the four email and SMS apps renders the signup, and where Alia's popup appears.
2. Whether Okendo's loyalty features show anywhere outside the product page.
3. Where Afterpay's message sits in the buy box on mobile.
4. Whether the cart's free-shipping bar comes from the theme or an app.
