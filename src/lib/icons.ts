/** Original store logos and official Theme Store thumbnails mirrored in R2 (data/curation/icons.json). */
import manifest from '../../data/curation/icons.json';

type StoreIcon = { key: string; w?: number; h?: number };
const stores = (manifest as { stores: Record<string, StoreIcon> }).stores;
const themes = (manifest as { themes?: Record<string, StoreIcon> }).themes ?? {};

export type StoreLogo = { src: string; w: number; h: number };

/** Site-relative URL of a store's own logo, when we have mirrored one. */
export function storeLogoSrc(domain: string): string | null {
  return storeLogo(domain)?.src ?? null;
}

/** Logo URL plus intrinsic size (for aspect-aware tiles). Square when size is unknown. */
export function storeLogo(domain: string): StoreLogo | null {
  const hit = stores[domain.replace(/^www\./, '')];
  if (!hit) return null;
  return { src: `/media/${hit.key}`, w: hit.w ?? 128, h: hit.h ?? 128 };
}

/** Official Theme Store thumbnail, mirrored for theme marks. */
export function themeLogo(slug: string): StoreLogo | null {
  const hit = themes[slug];
  if (!hit) return null;
  return { src: `/media/${hit.key}`, w: hit.w ?? 256, h: hit.h ?? 256 };
}
