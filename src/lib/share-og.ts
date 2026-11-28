/**
 * Paths of typographic Open Graph / Twitter images written at batch time
 * (`npm run ops:og-images`) into the media bucket under og/.
 */
export type ShareOgKind = 'home' | 'store' | 'app' | 'theme' | 'gallery' | 'compare';

export function shareOgSrc(kind: ShareOgKind, key?: string): string {
  if (kind === 'home') return '/media/og/home.jpg';
  if (!key) return `/media/og/${kind}.jpg`;
  return `/media/og/${kind}/${key}.jpg`;
}
