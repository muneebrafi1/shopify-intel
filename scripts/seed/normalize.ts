/** Pure value normalisers for seed inputs. */

/** "$400" → 40000, "Free" / "Free to install" → 0, unparseable → null. */
export function priceToCents(label: string | null | undefined): number | null {
  if (label == null) return null;
  const text = label.trim();
  if (/^free\b/i.test(text)) return 0;
  const m = /^\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(text);
  if (!m?.[1]) return null;
  return Math.round(Number(m[1].replace(/,/g, '')) * 100);
}

/** Dollars (float) → integer cents. */
export function dollarsToCents(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 100);
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** "September 20, 2012" → "2012-09-20" (no Date parsing, so no timezone drift). */
export function parseLongDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value.trim());
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** "easy-location" → "Easy Location". */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** True when a scraped App Store name is really a search-results page title. */
export function isScrapedSearchTitle(name: string): boolean {
  return /^search results for\b/i.test(name.trim());
}

/**
 * Brand part of an App Store listing name: text before ': ', ' | ' or a spaced dash/ornament
 * ("Klaviyo: Email Marketing & SMS" → "Klaviyo"). Editorial overrides win (data/curation/apps.json).
 */
export function shortAppName(name: string): string {
  const short = name.split(/\s*[:|]\s+|\s+[-\u2011\u2013\u2014»\u2726\u2727]\s+/u)[0]?.trim();
  return short && short.length >= 2 ? short : name.trim();
}
