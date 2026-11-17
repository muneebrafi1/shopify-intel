/**
 * Image URL helpers shared by every screenshot surface.
 *
 * Grids never load a whole full-page capture: they request the top of the page only.
 *  - Placeholders (drawn SVGs) take `?h=<css px>` and render just that slice.
 *  - Real captures (R2) go through Cloudflare Image Resizing when IMAGE_TRANSFORMS is on
 *    (crop from the top at a fixed width). Until then they are served as-is.
 */
import type { Device } from './taxonomy';

/** Flip to true once the zone has Image Resizing enabled (see docs/ARCHITECTURE.md). */
export const IMAGE_TRANSFORMS = false;

export const isPlaceholderSrc = (src: string) => src.startsWith('/media/placeholder/');

/** How much of the page a thumbnail shows, as a multiple of the capture width. */
export const THUMB_CROP: Record<Device, number> = { desktop: 0.9, mobile: 2.6 };

export function thumbCropHeight(width: number, height: number, device: Device): number {
  return Math.min(height, Math.round(width * THUMB_CROP[device]));
}

export function thumbUrl(src: string, opts: { cropHeight: number; width?: number }): string {
  if (isPlaceholderSrc(src)) {
    const sep = src.includes('?') ? '&' : '?';
    return `${src}${sep}h=${opts.cropHeight}`;
  }
  if (IMAGE_TRANSFORMS) {
    const w = opts.width ?? 720;
    return `/cdn-cgi/image/width=${w},fit=crop,gravity=top,format=auto${src}`;
  }
  return src;
}
