/**
 * Section detection for real captures. Shopify Online Store 2.0 themes wrap every section in
 * `<div id="shopify-section-{template|sections}--<id>__<handle>" class="shopify-section ...">`.
 * The handle is the section's key in the template JSON (usually the Liquid file name plus a
 * random suffix), and the class often carries `shopify-section--<type>` and the section group
 * (header / footer / overlay). We map those names to our section taxonomy with keyword rules.
 *
 * The rules are deliberately conservative: a section we cannot name confidently is dropped
 * (it stays visible in the full-page capture, it just gets no outline or library tile). Every
 * kept section records how it was classified in `hints.classified_by`.
 */
import type { SectionType } from '../../src/lib/taxonomy.ts';

export interface RawSection {
  /** Element id, e.g. "shopify-section-template--21178154778812__slideshow". */
  id: string;
  className: string;
  /** Document y and height in CSS px (y includes the scroll offset). */
  y: number;
  height: number;
  /** ids of `.shopify-app-block` elements inside the section. */
  appBlocks: string[];
  /** Product sections: the media gallery and buy-box boxes inside them (document CSS px). */
  split?: {
    gallery: { x: number; y: number; w: number; h: number } | null;
    buy: { x: number; y: number; w: number; h: number };
  } | null;
}

export type SectionGroupName = 'header' | 'footer' | 'overlay' | 'template' | 'other';

export interface ParsedSection {
  group: SectionGroupName;
  /** Template key without the random suffix, lowercased, words joined with '-'. */
  handle: string;
  /** Raw template key (kept as theme_section_name). */
  key: string;
  /** `shopify-section--<type>` modifier from the class, when the theme adds one. */
  typeClass: string | null;
}

/** "featured_collection_mAQXmK" → "featured-collection"; numeric app keys stay numeric. */
export function cleanHandle(key: string): string {
  const noSuffix = key.replace(/[_-](?=[A-Za-z0-9]{6}$)(?=.*[A-Z0-9])[A-Za-z0-9]{6}$/, '');
  return noSuffix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseSection(raw: Pick<RawSection, 'id' | 'className'>): ParsedSection {
  const m = /^shopify-section-(template|sections)--[^_]+__(.+)$/.exec(raw.id);
  const key = m?.[2] ?? raw.id.replace(/^shopify-section-/, '');
  const cls = raw.className;
  let group: SectionGroupName = m?.[1] === 'template' ? 'template' : 'other';
  if (/shopify-section-group-header/.test(cls)) group = 'header';
  else if (/shopify-section-group-footer/.test(cls)) group = 'footer';
  else if (/shopify-section-group-(overlay|popup|aside)/.test(cls)) group = 'overlay';
  const typeClass = /(?:^|\s)shopify-section--([a-z0-9-]+)/.exec(cls)?.[1] ?? null;
  return { group, handle: cleanHandle(key), key, typeClass };
}

/** Ordered keyword rules: first match wins. Patterns match whole words in "a-b-c" handles. */
const RULES: Array<[SectionType, RegExp]> = [
  ['announcement-bar', /announcement|announce|promo-bar|top-bar|notification-bar|ticker/],
  ['footer', /(^|-)footer($|-)/],
  ['header', /(^|-)(header|navigation|nav|menu|mega-menu)($|-)/],
  ['newsletter', /newsletter|email-signup|signup|sign-up|subscribe|klaviyo|join-list/],
  ['slideshow', /slideshow|slider-banner|hero-slider|hero-carousel|banner-slider/],
  ['hero', /(^|-)(hero|image-banner|banner|masthead|full-width-image|splash)($|-)/],
  ['video', /(^|-)video($|-)/],
  ['logo-list', /(^|-)(logo|logos|logo-list|press|as-seen|featured-in|brands)($|-)/],
  ['testimonials', /testimonial|quote/],
  ['ugc-gallery', /instagram|insta|ugc|(^|-)social|covet|tiktok|foursixty|shoppable/],
  ['reviews', /review|judge-?me|okendo|yotpo|loox|stamped|junip|reviews-io/],
  ['faq', /(^|-)(faq|faqs|accordion|collapsible)/],
  ['blog-posts', /(^|-)(blog|blogs|article|articles|journal|workshop|workshops)($|-)/],
  ['collection-list', /collection-list|collections-list|categor|shop-by|collection-grid/],
  [
    'featured-collection',
    /featured-collection|featured-product|product-grid|product-list|product-carousel|product-slider|products|best-?seller|new-arrival|(^|-)shop-the/,
  ],
  ['loyalty', /loyalty|rewards/],
  [
    'trust-badges',
    /trust|(^|-)usp|benefit|reasons|perks|guarantee|icons|icon-bar|value-prop|features-bar/,
  ],
  ['image-with-text', /image-with-text|image-text|media-with-text|text-with-image|split|story/],
  ['rich-text', /rich-text|(^|-)text($|-)|marquee|heading|intro|multicolumn|multi-column/],
];

/** Rules for the main sections of non-home templates, checked before the shared rules. */
const PAGE_RULES: Record<string, Array<[SectionType, RegExp]>> = {
  collection: [
    ['collection-header', /collection-(banner|header|hero|title|intro)|main-collection-banner/],
    ['filters', /(^|-)(facets|filters|filter)($|-)/],
    [
      'product-grid',
      /main-collection|collection-product-grid|product-grid|collection-grid|(^|-)main($|-)/,
    ],
  ],
  product: [
    ['upsell', /recommend|related|complementary|also-like|upsell|cross-sell|pairs-with|bundle/],
    ['recently-viewed', /recently-viewed/],
    ['product-details', /collapsible|product-details|product-tabs|description|specs|accordion/],
    ['buy-box', /main-product|product-template|product-main|featured-product|^main$|^product$/],
  ],
  cart: [
    ['cart-summary', /cart-footer|cart-summary|cart-totals|subtotal/],
    ['cart-items', /main-cart|cart-items|cart-template|(^|-)cart($|-)|(^|-)main($|-)/],
    ['upsell', /recommend|related|complementary|upsell|cross-sell/],
  ],
};

function matchRules(text: string, pageType = 'home'): SectionType | null {
  for (const [type, re] of PAGE_RULES[pageType] ?? []) if (re.test(text)) return type;
  for (const [type, re] of RULES) if (re.test(text)) return type;
  return null;
}

/** App-block ids: "shopify-block-<b64>__instafeed_app_block_Pm9WUp" → "instafeed-app-block". */
export const appBlockHandle = (id: string) =>
  cleanHandle(id.replace(/^shopify-block-[^_]+__/, '').replace(/_app_block.*$/, ''));

export interface ClassifyContext {
  /** Template the page renders ('home' when omitted). */
  pageType?: string;
  /** Index of this section among the visible template sections (0 = first). */
  templateIndex: number;
  /** Slugs of the apps detected on the store (for app-block attribution). */
  storeApps: readonly string[];
}

export interface Classified {
  type: SectionType;
  appSlug: string | null;
  by: 'name' | 'class' | 'app-block' | 'position';
  parsed: ParsedSection;
}

/** Finds the detected store app that renders one of the section's app blocks. */
export function attributeApp(appBlocks: readonly string[], storeApps: readonly string[]) {
  const handles = appBlocks.map((id) => appBlockHandle(id).replace(/-/g, ''));
  for (const slug of storeApps) {
    const flat = slug.replace(/-/g, '');
    const head = slug.split('-')[0] ?? '';
    for (const h of handles) {
      if (h.length < 4) continue;
      if (h.includes(flat) || (head.length >= 5 && h.startsWith(head))) return slug;
    }
  }
  return null;
}

export function classifySection(raw: RawSection, ctx: ClassifyContext): Classified | null {
  const parsed = parseSection(raw);
  if (parsed.group === 'overlay') return null;
  const appSlug = attributeApp(raw.appBlocks, ctx.storeApps);
  const done = (type: SectionType | null, by: Classified['by']): Classified | null =>
    type ? { type, appSlug, by, parsed } : null;

  // Header/footer groups only hold chrome: never call them heroes or product grids.
  if (parsed.group === 'header') {
    const t = matchRules(parsed.handle) ?? matchRules(parsed.typeClass ?? '');
    if (t === 'announcement-bar' || t === 'header') return done(t, 'name');
    return raw.height <= 64 ? done('announcement-bar', 'position') : null;
  }
  if (parsed.group === 'footer') {
    const t = matchRules(parsed.handle) ?? matchRules(parsed.typeClass ?? '');
    if (t === 'footer' || t === 'newsletter' || t === 'trust-badges') return done(t, 'name');
    return null;
  }

  const isAppSection = /^\d+$/.test(parsed.handle) || parsed.typeClass === 'apps';
  const page = ctx.pageType ?? 'home';
  if (!isAppSection) {
    const byName = matchRules(parsed.handle, page);
    if (byName) return done(byName, 'name');
    const byClass = parsed.typeClass ? matchRules(parsed.typeClass, page) : null;
    if (byClass) return done(byClass, 'class');
  }
  if (raw.appBlocks.length) {
    const byBlock = matchRules(raw.appBlocks.map(appBlockHandle).join(' '));
    if (byBlock) return done(byBlock, 'app-block');
  }
  // The first tall template section on a home page is its hero, whatever the theme calls it.
  if (page === 'home' && !isAppSection && ctx.templateIndex === 0 && raw.height >= 280)
    return done('hero', 'position');
  return null;
}
