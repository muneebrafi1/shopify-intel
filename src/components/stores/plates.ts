/** URL helpers for store plates (?page=&device=, defaults home/desktop are omitted). */
import { CORE_PAGE_TYPES, type Device } from '~/lib/taxonomy';

export const DEFAULT_PAGE = 'home';
export const DEFAULT_DEVICE: Device = 'desktop';

export function plateHref(basePath: string, page: string, device: Device, hash = ''): string {
  const sp = new URLSearchParams();
  if (page !== DEFAULT_PAGE) sp.set('page', page);
  if (device !== DEFAULT_DEVICE) sp.set('device', device);
  const qs = sp.toString();
  return `${basePath}${qs ? `?${qs}` : ''}${hash}`;
}

export function parsePlate(url: URL, available: string[]): { page: string; device: Device } {
  const page = url.searchParams.get('page') ?? DEFAULT_PAGE;
  const device = url.searchParams.get('device') === 'mobile' ? 'mobile' : DEFAULT_DEVICE;
  const known = available.length ? available : (CORE_PAGE_TYPES as string[]);
  return { page: known.includes(page) ? page : (known[0] ?? DEFAULT_PAGE), device };
}

/** "Reviews on the product page" style phrase for where a section sits. */
export function onPage(pageName: string): string {
  return `${pageName.toLowerCase()} page`;
}
