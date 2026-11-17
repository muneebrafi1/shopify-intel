/**
 * Shared vocabulary for the visual library. This file is the contract between:
 *  - the seed / ingest pipeline (which pages and sections exist),
 *  - the placeholder renderer (how a pending capture is drawn),
 *  - the UI (labels, filters, ordering) and the public API.
 * Slugs are stable public identifiers (they appear in URLs and the API). Add, don't rename.
 */

export const PAGE_TYPES = [
  { slug: 'home', name: 'Home', plural: 'Home pages' },
  { slug: 'collection', name: 'Collection', plural: 'Collection pages' },
  { slug: 'product', name: 'Product', plural: 'Product pages' },
  { slug: 'cart', name: 'Cart', plural: 'Cart pages' },
  { slug: 'search', name: 'Search', plural: 'Search results' },
  { slug: 'blog', name: 'Blog', plural: 'Blog indexes' },
  { slug: 'article', name: 'Article', plural: 'Articles' },
  { slug: 'page', name: 'Content page', plural: 'Content pages' },
  { slug: 'not-found', name: '404', plural: '404 pages' },
] as const;
export type PageType = (typeof PAGE_TYPES)[number]['slug'];

/** Page types every curated store is captured on (the core capture plan). */
export const CORE_PAGE_TYPES: PageType[] = ['home', 'collection', 'product', 'cart'];

export const DEVICES = [
  { slug: 'desktop', name: 'Desktop', viewport: 1440 },
  { slug: 'mobile', name: 'Mobile', viewport: 390 },
] as const;
export type Device = (typeof DEVICES)[number]['slug'];

export const SECTION_GROUPS = [
  { slug: 'navigation', name: 'Navigation' },
  { slug: 'hero-media', name: 'Hero & media' },
  { slug: 'merchandising', name: 'Merchandising' },
  { slug: 'product', name: 'Product' },
  { slug: 'social-proof', name: 'Social proof' },
  { slug: 'conversion', name: 'Conversion' },
  { slug: 'cart', name: 'Cart' },
  { slug: 'content', name: 'Content' },
] as const;
export type SectionGroup = (typeof SECTION_GROUPS)[number]['slug'];

/**
 * Section types a page can be sliced into. `pages` lists where the section usually appears
 * (used for placeholder layouts and default filters, not as a hard rule).
 */
export const SECTION_TYPES = [
  // Navigation
  {
    slug: 'announcement-bar',
    name: 'Announcement bar',
    group: 'navigation',
    pages: ['home', 'collection', 'product', 'cart'],
    description: 'Thin strip above the header for shipping offers, promos and notices.',
  },
  {
    slug: 'header',
    name: 'Header',
    group: 'navigation',
    pages: ['home', 'collection', 'product', 'cart'],
    description: 'Logo, main navigation, search, account and cart.',
  },
  {
    slug: 'breadcrumbs',
    name: 'Breadcrumbs',
    group: 'navigation',
    pages: ['collection', 'product'],
    description: 'Path back to parent collections.',
  },
  {
    slug: 'footer',
    name: 'Footer',
    group: 'navigation',
    pages: ['home', 'collection', 'product', 'cart'],
    description: 'Link columns, newsletter, payment icons and legal.',
  },
  // Hero & media
  {
    slug: 'hero',
    name: 'Hero',
    group: 'hero-media',
    pages: ['home'],
    description: 'The first full-width banner: image or video, headline and call to action.',
  },
  {
    slug: 'slideshow',
    name: 'Slideshow',
    group: 'hero-media',
    pages: ['home'],
    description: 'Rotating banners.',
  },
  {
    slug: 'image-with-text',
    name: 'Image with text',
    group: 'hero-media',
    pages: ['home', 'product'],
    description: 'Image beside a block of copy, often brand story or a feature.',
  },
  {
    slug: 'video',
    name: 'Video',
    group: 'hero-media',
    pages: ['home', 'product'],
    description: 'Embedded or background video.',
  },
  {
    slug: 'logo-list',
    name: 'Logo list',
    group: 'hero-media',
    pages: ['home'],
    description: 'Press mentions, retailers or partner logos.',
  },
  // Merchandising
  {
    slug: 'featured-collection',
    name: 'Featured collection',
    group: 'merchandising',
    pages: ['home'],
    description: 'A row or grid of products from one collection.',
  },
  {
    slug: 'collection-list',
    name: 'Collection list',
    group: 'merchandising',
    pages: ['home'],
    description: 'Tiles linking to collections or categories.',
  },
  {
    slug: 'collection-header',
    name: 'Collection header',
    group: 'merchandising',
    pages: ['collection'],
    description: 'Collection title, description and banner.',
  },
  {
    slug: 'filters',
    name: 'Filters & sorting',
    group: 'merchandising',
    pages: ['collection', 'search'],
    description: 'Facets, sort control and result counts.',
  },
  {
    slug: 'product-grid',
    name: 'Product grid',
    group: 'merchandising',
    pages: ['collection', 'search'],
    description: 'The main grid of product cards.',
  },
  {
    slug: 'upsell',
    name: 'Upsell & cross-sell',
    group: 'merchandising',
    pages: ['product', 'cart'],
    description: 'Frequently bought together, bundles and "you may also like".',
  },
  {
    slug: 'recently-viewed',
    name: 'Recently viewed',
    group: 'merchandising',
    pages: ['product'],
    description: 'Products the shopper looked at before.',
  },
  // Product
  {
    slug: 'product-gallery',
    name: 'Product gallery',
    group: 'product',
    pages: ['product'],
    description: 'Product images and video, thumbnails or slider.',
  },
  {
    slug: 'buy-box',
    name: 'Buy box',
    group: 'product',
    pages: ['product'],
    description: 'Title, price, variants, quantity and add to cart.',
  },
  {
    slug: 'product-details',
    name: 'Product details',
    group: 'product',
    pages: ['product'],
    description: 'Description, specs, tabs or accordions.',
  },
  // Social proof
  {
    slug: 'reviews',
    name: 'Reviews',
    group: 'social-proof',
    pages: ['product', 'home'],
    description: 'Star ratings, review lists and photo reviews.',
  },
  {
    slug: 'testimonials',
    name: 'Testimonials',
    group: 'social-proof',
    pages: ['home'],
    description: 'Hand-picked quotes from customers or press.',
  },
  {
    slug: 'ugc-gallery',
    name: 'UGC & social feed',
    group: 'social-proof',
    pages: ['home', 'product'],
    description: 'Instagram feeds, shoppable videos and customer photos.',
  },
  {
    slug: 'trust-badges',
    name: 'Trust badges',
    group: 'social-proof',
    pages: ['product', 'cart'],
    description: 'Guarantees, shipping and payment reassurance.',
  },
  // Conversion
  {
    slug: 'newsletter',
    name: 'Newsletter signup',
    group: 'conversion',
    pages: ['home'],
    description: 'Inline email or SMS capture.',
  },
  {
    slug: 'shipping-bar',
    name: 'Free shipping bar',
    group: 'conversion',
    pages: ['cart'],
    description: 'Progress toward a free-shipping threshold.',
  },
  {
    slug: 'loyalty',
    name: 'Loyalty & rewards',
    group: 'conversion',
    pages: ['home', 'product'],
    description: 'Points, tiers and referral prompts.',
  },
  // Cart
  {
    slug: 'cart-items',
    name: 'Cart line items',
    group: 'cart',
    pages: ['cart'],
    description: 'Products in the cart with quantity controls.',
  },
  {
    slug: 'cart-summary',
    name: 'Cart summary',
    group: 'cart',
    pages: ['cart'],
    description: 'Subtotal, notes, shipping protection and checkout buttons.',
  },
  // Content
  {
    slug: 'rich-text',
    name: 'Rich text',
    group: 'content',
    pages: ['home', 'page'],
    description: 'A headline and paragraph, often a brand statement.',
  },
  {
    slug: 'faq',
    name: 'FAQ',
    group: 'content',
    pages: ['product', 'page'],
    description: 'Collapsible questions and answers.',
  },
  {
    slug: 'blog-posts',
    name: 'Blog posts',
    group: 'content',
    pages: ['home', 'blog'],
    description: 'Article cards from the store blog.',
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  name: string;
  group: SectionGroup;
  pages: readonly PageType[];
  description: string;
}>;
export type SectionType = (typeof SECTION_TYPES)[number]['slug'];

/**
 * Where apps from a category usually render on a storefront. Used to attribute placeholder
 * sections to a detected app and to explain "where this app shows up". The first entry is the
 * primary surface. Categories without a visible surface map to [].
 */
export const APP_CATEGORY_SURFACES: Record<string, SectionType[]> = {
  Reviews: ['reviews'],
  'Video & UGC': ['ugc-gallery'],
  'Email & SMS': ['newsletter'],
  'Upsell & Bundles': ['upsell'],
  'Loyalty & Rewards': ['loyalty'],
  Subscriptions: ['buy-box'],
  'Payments & BNPL': ['buy-box'],
  'Wishlist & Back in Stock': ['buy-box'],
  'Product Options & Sizing': ['buy-box'],
  'Cart & Checkout': ['shipping-bar'],
  'Shipping & Returns': ['cart-summary'],
  'Page Builders & Sections': ['image-with-text'],
  'Popups & Social Proof': ['newsletter'],
  'Currency & Translation': ['header'],
  'Chat & Support': [],
  'Privacy & Security': [],
  'Affiliate & Referral': [],
  'Ads & Channels': [],
  'Testing & Personalization': [],
  'Search & Merchandising': ['filters'],
  'Store Design': [],
  Analytics: [],
};

/** Display names for tracking pixels / analytics tags detected on stores. */
export const PIXELS: Record<string, string> = {
  ga4: 'Google Analytics 4',
  gtm: 'Google Tag Manager',
  'google-ads': 'Google Ads',
  'meta-pixel': 'Meta Pixel',
  'pinterest-tag': 'Pinterest Tag',
  'tiktok-pixel': 'TikTok Pixel',
  microsoftuet: 'Microsoft UET',
  northbeam: 'Northbeam',
  triplewhale: 'Triple Whale',
  heap: 'Heap',
  liveintent: 'LiveIntent',
  luckyorange: 'Lucky Orange',
  hotjar: 'Hotjar',
  clarity: 'Microsoft Clarity',
  snapchat: 'Snap Pixel',
};

export const pageTypeName = (slug: string) => PAGE_TYPES.find((p) => p.slug === slug)?.name ?? slug;
export const sectionTypeName = (slug: string) =>
  SECTION_TYPES.find((s) => s.slug === slug)?.name ?? slug;
export const deviceName = (slug: string) => DEVICES.find((d) => d.slug === slug)?.name ?? slug;
