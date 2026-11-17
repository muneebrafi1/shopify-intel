/** URL slug: lowercase ASCII words joined by hyphens. '&' reads as 'and' ("Email & SMS" → "email-and-sms"). */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalises user or crawler input to a bare store domain: no scheme, path, port or leading
 * "www.". Returns null when the result is not a plausible public hostname.
 */
export function normalizeDomain(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#]/)[0] ?? '';
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  host = host.replace(/^www\./, '');
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  const re = new RegExp(`^(?:${label}\\.)+[a-z]{2,63}$`);
  return host.length <= 253 && re.test(host) ? host : null;
}
