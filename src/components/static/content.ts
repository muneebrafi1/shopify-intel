/**
 * Copy and settings shared by the static, legal, trust, account and Pro pages.
 * Values marked OWNER are business decisions the owner can change here, in one place.
 */

/** Date shown as "last updated" on the legal drafts (YYYY-MM-DD). OWNER: bump when you edit. */
export const LEGAL_UPDATED = '2026-11-17';

/**
 * OWNER: promised handling time for removal requests. Shown on /opt-out and in the
 * confirmation. Keep it a phrase that reads after "We aim to handle it".
 */
export const REMOVAL_SLA = 'within 3 business days';

/** The trust/legal documents, in the order the doc switcher lists them. */
export const TRUST_DOCS = [
  { href: '/about', label: 'About' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/affiliate-disclosure', label: 'Affiliate disclosure' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/opt-out', label: 'Remove your store' },
] as const;

export interface TocItem {
  id: string;
  label: string;
}

/**
 * Only allow same-site relative paths as a post-sign-in destination (no open redirects:
 * "//evil.com" and "/\\evil.com" are rejected).
 */
export function safeNext(value: string | null | undefined, fallback = '/account'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.length > 300) return fallback;
  return value;
}

// ---------------------------------------------------------------------------------------------
// Pricing (OWNER: planned launch prices from docs/BRIEF.md; checkout runs on Whop later)
// ---------------------------------------------------------------------------------------------
export type Billing = 'monthly' | 'yearly';

export interface Price {
  /** Whole USD. */
  amount: number;
  per: 'month' | 'year' | null;
  /** Small line under the price. */
  note: string;
}

export interface Plan {
  id: 'free' | 'pro' | 'team';
  name: string;
  /** One line under the name. */
  forWho: string;
  price: Record<Billing, Price>;
  cta: { label: string; href: string };
  recommended?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    forWho: 'For choosing a theme or an app',
    price: {
      monthly: { amount: 0, per: null, note: 'No account needed' },
      yearly: { amount: 0, per: null, note: 'No account needed' },
    },
    cta: { label: 'Start browsing', href: '/stores' },
  },
  {
    id: 'pro',
    name: 'Pro',
    forWho: 'For designers, agencies and freelancers',
    price: {
      monthly: { amount: 12, per: 'month', note: 'Billed monthly' },
      yearly: { amount: 96, per: 'year', note: '$8 a month, billed yearly' },
    },
    cta: { label: 'Get Pro', href: '/sign-in?next=/pro' },
    recommended: true,
  },
  {
    id: 'team',
    name: 'Team',
    forWho: 'For studios working on client stores',
    price: {
      monthly: { amount: 39, per: 'month', note: 'Billed monthly' },
      yearly: { amount: 39, per: 'month', note: 'Billed monthly' },
    },
    cta: { label: 'Get Team', href: '/sign-in?next=/pro' },
  },
];

/** Saving of Pro yearly over twelve monthly payments, as a whole percentage. */
export const YEARLY_SAVING = Math.round((1 - 96 / (12 * 12)) * 100);

/** Feature matrix. `true` = included, `false` = not included, string = limited or a value. */
export type Cell = boolean | string;
export const PLAN_MATRIX: {
  group: string;
  rows: { label: string; free: Cell; pro: Cell; team: Cell }[];
}[] = [
  {
    group: 'Library',
    rows: [
      { label: 'Stores, themes and apps', free: true, pro: true, team: true },
      { label: 'Home page screenshots', free: true, pro: true, team: true },
      { label: 'Collection, product, cart and other pages', free: false, pro: true, team: true },
      { label: 'Mobile captures', free: 'Home only', pro: true, team: true },
      { label: 'Full pages sliced into sections', free: 'Home only', pro: true, team: true },
      { label: 'Filter by section, theme and app', free: 'Section type', pro: true, team: true },
    ],
  },
  {
    group: 'Work',
    rows: [
      { label: 'Boards', free: false, pro: true, team: 'Shared' },
      { label: 'CSV exports', free: false, pro: true, team: true },
      { label: 'Theme-switch alerts', free: false, pro: true, team: true },
      { label: 'Seats', free: false, pro: '1', team: 'Several' },
    ],
  },
  {
    group: 'Data',
    rows: [
      { label: 'Detected themes and apps', free: true, pro: true, team: true },
      { label: 'App Store facts with dates', free: true, pro: true, team: true },
      { label: 'Public JSON API', free: 'Fair use', pro: 'Fair use', team: 'Fair use' },
      { label: 'Revenue or traffic estimates', free: 'Never', pro: 'Never', team: 'Never' },
    ],
  },
];

/** OWNER: launch lifetime deal. */
export const LIFETIME = { price: 79, cap: 100 } as const;

// ---------------------------------------------------------------------------------------------
// Example boards (shown on /account/boards until accounts exist; always labelled "Example")
// ---------------------------------------------------------------------------------------------
export interface ExampleBoard {
  id: string;
  name: string;
  description: string;
  query: {
    type?: 'reviews' | 'header' | 'hero' | 'buy-box' | 'footer';
    page_type?: 'home' | 'product' | 'collection' | 'cart';
    device?: 'desktop' | 'mobile';
  };
}

export const EXAMPLE_BOARDS: ExampleBoard[] = [
  {
    id: 'example-reviews',
    name: 'Product page reviews',
    description: 'How stores lay out reviews under the buy box, for a client pitch.',
    query: { type: 'reviews', page_type: 'product' },
  },
  {
    id: 'example-buy-boxes',
    name: 'Buy boxes',
    description: 'Price, variants and add-to-cart on real product pages.',
    query: { type: 'buy-box' },
  },
  {
    id: 'example-mobile-headers',
    name: 'Mobile headers',
    description: 'Logo, menu, search and cart at 390px wide.',
    query: { type: 'header', device: 'mobile' },
  },
];

/** Board ids in URLs: lowercase slug. */
export function isBoardId(value: string | undefined): value is string {
  return !!value && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}
