/** Original store logos mirrored in R2 (data/curation/icons.json, written by scripts/icons/fetch.ts). */
import manifest from '../../data/curation/icons.json';

const stores = (manifest as { stores: Record<string, { key: string }> }).stores;

/** Site-relative URL of a store's own logo, when we have mirrored one. */
export function storeLogoSrc(domain: string): string | null {
  const hit = stores[domain.replace(/^www\./, '')];
  return hit ? `/media/${hit.key}` : null;
}
