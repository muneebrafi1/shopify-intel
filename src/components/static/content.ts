/**
 * Copy and settings shared by the static, legal, trust, account and Pro pages.
 * Values marked OWNER are business decisions the owner can change here, in one place.
 */

/** Date shown as "last updated" on the legal drafts (YYYY-MM-DD). OWNER: bump when you edit. */
export const LEGAL_UPDATED = '2026-11-17';

/**
 * OWNER: draft. Promised handling time for removal requests. Shown on /opt-out and in the
 * confirmation. Keep it a phrase that reads after "We aim to handle it".
 */
export const REMOVAL_SLA = 'within 3 business days';

/** OWNER: draft. How long removal-request records are kept after a request is closed. */
export const REMOVAL_RETENTION = '2 years';

/** OWNER: draft. Governing law of the terms (the operator is LEGAL_ENTITY in config/site). */
export const GOVERNING_LAW = 'Pakistan';

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
// Pricing. Checkout runs on Whop later; nothing on the site charges anyone yet.
// OWNER: draft. Plans, prices and the feature split are the owner's 17 Nov 2026 decisions:
//   Free = home-page screenshots + basic theme and app data.
//   Pro  = every page type, full-page and section-by-section screenshots, CSV exports.
//   Team = Pro for 3 seats. Yearly billing = 2 months free.
// Other pages (the home Pro band) read PLANS: keep the exported names and shapes stable.
// ---------------------------------------------------------------------------------------------
export type Billing = 'monthly' | 'yearly';

export interface Price {
  /** USD for the period in `per`. */
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
  /** Key features on the plan card (the full list is PLAN_MATRIX). */
  features: string[];
  /** Seats included. */
  seats: number;
}

/** OWNER: draft. Months you don't pay for when billed yearly (yearly = 10 × monthly). */
export const YEARLY_FREE_MONTHS = 2;
/** Label for the yearly toggle and notes: "2 months free". */
export const YEARLY_LABEL = `${YEARLY_FREE_MONTHS} months free`;

/** OWNER: draft. Monthly prices in USD. Yearly prices are derived from them. */
export const MONTHLY_PRICE = { pro: 12, team: 39 } as const;

const yearlyFrom = (monthly: number) => monthly * (12 - YEARLY_FREE_MONTHS);
const money = (amount: number) => `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
const yearlyNote = (monthly: number) => `${money(yearlyFrom(monthly) / 12)} a month, billed yearly`;

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
    features: [
      'Home page screenshots of every store',
      'Basic theme and app data',
      'Store, theme and app pages',
      'Public JSON API within fair use',
    ],
    seats: 1,
  },
  {
    id: 'pro',
    name: 'Pro',
    forWho: 'For designers, agencies and freelancers',
    price: {
      monthly: { amount: MONTHLY_PRICE.pro, per: 'month', note: 'Billed monthly' },
      yearly: {
        amount: yearlyFrom(MONTHLY_PRICE.pro),
        per: 'year',
        note: yearlyNote(MONTHLY_PRICE.pro),
      },
    },
    cta: { label: 'Get Pro', href: '/sign-in?next=/pro' },
    recommended: true,
    features: [
      'Everything in Free',
      'Collection, product, cart and other pages',
      'Full-page and section-by-section screenshots',
      'Full theme and app data',
      'CSV exports',
      'Boards and theme-switch alerts',
    ],
    seats: 1,
  },
  {
    id: 'team',
    name: 'Team',
    forWho: 'For studios working on client stores',
    price: {
      monthly: { amount: MONTHLY_PRICE.team, per: 'month', note: 'Billed monthly' },
      yearly: {
        amount: yearlyFrom(MONTHLY_PRICE.team),
        per: 'year',
        note: yearlyNote(MONTHLY_PRICE.team),
      },
    },
    cta: { label: 'Get Team', href: '/sign-in?next=/pro' },
    features: ['Everything in Pro', '3 seats on one plan', 'Shared boards'],
    seats: 3,
  },
];

/**
 * Saving of yearly over twelve monthly payments, as a whole percentage (17 with 2 months
 * free). Kept for existing imports; in copy, say YEARLY_LABEL ("2 months free") instead.
 */
export const YEARLY_SAVING = Math.round((YEARLY_FREE_MONTHS / 12) * 100);

/** Feature matrix. `true` = included, `false` = not included, string = limited or a value. */
export type Cell = boolean | string;
export interface MatrixRow {
  label: string;
  /** One-line explanation under the label in the comparison table. */
  note?: string;
  free: Cell;
  pro: Cell;
  team: Cell;
}

/** OWNER: draft. Rows follow the plan split above. "Never" rows are promises, not limits. */
export const PLAN_MATRIX: { group: string; rows: MatrixRow[] }[] = [
  {
    group: 'Screenshots',
    rows: [
      {
        label: 'Home page screenshots',
        note: 'The home page of every store we capture.',
        free: true,
        pro: true,
        team: true,
      },
      {
        label: 'Collection, product, cart and other pages',
        note: 'Every page type we capture, not just the home page.',
        free: false,
        pro: true,
        team: true,
      },
      {
        label: 'Full-page and section screenshots',
        note: 'Each page top to bottom, sliced into tagged sections.',
        free: false,
        pro: true,
        team: true,
      },
      {
        label: 'Desktop and mobile',
        note: 'Captures at 1440px and 390px wide.',
        free: 'Home page',
        pro: true,
        team: true,
      },
    ],
  },
  {
    group: 'Data',
    rows: [
      {
        label: 'Theme and app data',
        note: 'Free shows the theme and apps on each store. Pro adds the full record.',
        free: 'Basic',
        pro: 'Full',
        team: 'Full',
      },
      {
        label: 'App Store facts with dates',
        note: 'Rating, reviews and pricing, with the date we checked them.',
        free: true,
        pro: true,
        team: true,
      },
      {
        label: 'Filters by section, theme and app',
        note: 'Narrow the library to exactly the pages you need.',
        free: 'Section type',
        pro: true,
        team: true,
      },
      {
        label: 'Public JSON API',
        note: 'The same data as the site, free within fair use.',
        free: 'Fair use',
        pro: 'Fair use',
        team: 'Fair use',
      },
      {
        label: 'Revenue or traffic estimates',
        note: 'They can’t be measured honestly from outside a store.',
        free: 'Never',
        pro: 'Never',
        team: 'Never',
      },
    ],
  },
  {
    group: 'Workflow',
    rows: [
      {
        label: 'CSV exports',
        note: 'Download stores, apps and sections into your own sheets.',
        free: false,
        pro: true,
        team: true,
      },
      {
        label: 'Boards',
        note: 'Save captures and sections for a pitch or a brief.',
        free: false,
        pro: true,
        team: 'Shared',
      },
      {
        label: 'Theme-switch alerts',
        note: 'An email when a store you follow changes theme.',
        free: false,
        pro: true,
        team: true,
      },
      {
        label: 'Seats',
        note: 'People who can sign in on the plan.',
        free: '1',
        pro: '1',
        team: '3',
      },
    ],
  },
];

/** OWNER: draft. Launch lifetime deal; the terms are not final. */
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
