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

export interface Plan {
  id: 'free' | 'pro' | 'team';
  name: string;
  /** One line under the name. */
  forWho: string;
  /** Price in whole USD per period; null = free. */
  monthly: number | null;
  yearly: number | null;
  /** Line under the price, per billing period. */
  note: Record<Billing, string>;
  cta: { label: string; href: string };
  /** "Everything in X, plus" lead-in. */
  includesFrom?: string;
  features: string[];
  recommended?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    forWho: 'For choosing a theme or an app',
    monthly: null,
    yearly: null,
    note: { monthly: 'No account needed', yearly: 'No account needed' },
    cta: { label: 'Start browsing', href: '/stores' },
    features: [
      'Every store, theme and app page',
      'Detected theme and apps per store',
      'Home page screenshots, desktop and mobile',
      'Comparisons and alternatives',
      'Public JSON API, fair use',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    forWho: 'For designers, agencies and freelancers',
    monthly: 12,
    yearly: 96,
    note: { monthly: 'Billed monthly', yearly: '$8 a month, billed yearly' },
    cta: { label: 'Get Pro', href: '/sign-in?next=/pro' },
    includesFrom: 'Everything in Free, plus',
    features: [
      'Every page type: collection, product, cart and more',
      'Desktop and mobile, full page and sliced into sections',
      'Filter the library by section, theme and app',
      'Boards to save and share references',
      'CSV exports of stores, themes and apps',
      'Theme-switch alerts for stores you follow',
    ],
    recommended: true,
  },
  {
    id: 'team',
    name: 'Team',
    forWho: 'For studios working on client stores',
    monthly: 39,
    yearly: 39,
    note: { monthly: 'Billed monthly', yearly: 'Billed monthly' },
    cta: { label: 'Get Team', href: '/sign-in?next=/pro' },
    includesFrom: 'Everything in Pro, plus',
    features: [
      'Shared boards for client pitches',
      'Several seats on one plan',
      'One invoice for the studio',
    ],
  },
];

/** Feature matrix under the plans. `true` = included, string = limited/explained. */
export const PLAN_MATRIX: { group: string; rows: { label: string; free: boolean | string; pro: boolean | string; team: boolean | string }[] }[] = [
  {
    group: 'Library',
    rows: [
      { label: 'Stores, themes and apps directory', free: true, pro: true, team: true },
      { label: 'Home page screenshots', free: true, pro: true, team: true },
      { label: 'Collection, product, cart and other pages', free: false, pro: true, team: true },
      { label: 'Mobile captures for every page', free: 'Home only', pro: true, team: true },
      { label: 'Sections library filters (section, theme, app)', free: 'Section type', pro: true, team: true },
    ],
  },
  {
    group: 'Work',
    rows: [
      { label: 'Boards', free: false, pro: true, team: 'Shared' },
      { label: 'CSV exports', free: false, pro: true, team: true },
      { label: 'Theme-switch alerts', free: false, pro: true, team: true },
      { label: 'Seats', free: '—', pro: '1', team: 'Several' },
    ],
  },
  {
    group: 'Data',
    rows: [
      { label: 'Detection data and App Store facts', free: true, pro: true, team: true },
      { label: 'Public JSON API', free: 'Fair use', pro: 'Fair use', team: 'Fair use' },
    ],
  },
];

/** OWNER: launch lifetime deal. */
export const LIFETIME = { price: 79, cap: 100 } as const;
