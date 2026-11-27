/** Display formatting. Keep all number/date/price formatting here so the site reads consistently. */

const LOCALE = 'en-US';

/** 50275 → "50,275"; 1234567 → "1.2M" when compact. */
export function formatCount(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(n) >= 10_000) {
    return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(
      n,
    );
  }
  return n.toLocaleString(LOCALE);
}

/** 41.18 → "41.2%" (input is already a percentage). Small shares keep one decimal. */
export function formatPercent(pct: number, digits = 1): string {
  return `${pct.toFixed(pct >= 10 ? Math.min(digits, 1) : digits)}%`;
}

/** "2026-11-17" or ISO → "17 Nov 2026". Dates are shown in UTC so they match the data. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d =
    typeof value === 'string'
      ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
      : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Price in cents → "$400", "$9.99", "Free". */
export function formatPrice(
  cents: number | null | undefined,
  opts: { currency?: string; free?: string } = {},
): string {
  if (cents === null || cents === undefined) return '—';
  if (cents === 0) return opts.free ?? 'Free';
  const value = cents / 100;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: opts.currency ?? 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** pluralize(1, 'store') → "1 store"; pluralize(3, 'store') → "3 stores". */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}

/** Strip protocol and trailing slash for display: "https://www.youngla.com/" → "youngla.com". */
export function displayDomain(urlOrDomain: string): string {
  return urlOrDomain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

/** Clean a store search subtitle: no "theme theme", and kebab theme handles become "Custom theme". */
export function tidyStoreSubtitle(subtitle: string | null | undefined): string | null {
  if (!subtitle) return subtitle ?? null;
  const split = subtitle.match(/^(.*?)( · \d+ apps?)$/i);
  const head = (split ? split[1] : subtitle).trim();
  const tail = split ? split[2] : '';
  let name = head.replace(/\s+theme\s+theme$/i, ' theme');
  const core = name.replace(/\s+theme$/i, '').trim();
  const isHandle = /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*\/?$/i.test(core) && /[-/]/.test(core);
  if (isHandle) name = 'Custom theme';
  return name + tail;
}
