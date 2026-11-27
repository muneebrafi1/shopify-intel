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

/**
 * Pre-cut top thumbnails. The capture pipeline writes `<key>.top.webp` next to every full-page
 * capture: the top THUMB_TOP[device] × capture width (CSS px) at THUMB_TOP_PX wide. Grids that
 * only show the top of a page use it instead of the full page (free, unlike Image Resizing).
 * Keep in sync with scripts/capture/process.ts (it imports these constants).
 */
export const THUMB_TOP: Record<Device, number> = { desktop: 1, mobile: 2.9 };
export const THUMB_TOP_PX: Record<Device, number> = { desktop: 960, mobile: 600 };
const CAPTURE_W: Record<Device, number> = { desktop: 1440, mobile: 390 };

/**
 * Whether a PinnedCapture of this section, in a frame of `ratio` (width/height), can be
 * served from the pre-cut top thumbnail instead of the full-page capture. Keep the offset
 * math in sync with PinnedCapture.astro.
 */
export function pinFitsTopThumb(
  section: {
    device: Device;
    rect: { y: number; h: number };
    screenshot: { width: number; height: number };
  },
  ratio: number,
): boolean {
  const imgW = section.screenshot.width;
  const imgH = section.screenshot.height;
  const frameH = imgW / ratio;
  const ctx = Math.max(
    imgW * (section.device === 'mobile' ? 0.14 : 0.1),
    (frameH - section.rect.h) / 2,
  );
  const offset = Math.max(0, Math.min(section.rect.y - ctx, imgH - frameH));
  const served = Math.min(imgH, Math.ceil(offset + frameH + 2));
  return served <= CAPTURE_W[section.device] * THUMB_TOP[section.device];
}

/** `/media/shots/<domain>/<page>/<device>/<stamp>.webp` → its device, else null. */
export function captureDevice(src: string): Device | null {
  const m = /\/shots\/[^/]+\/[^/]+\/(desktop|mobile)\/[^/]+\.webp$/.exec(src.split('?')[0] ?? '');
  return m ? (m[1] as Device) : null;
}

export const topThumbKey = (key: string) => key.replace(/(\.top)?\.webp$/, '.top.webp');
/** 1200×630 social-preview crop of a desktop capture, written next to it by the capture pipeline. */
export const ogKey = (key: string) => key.replace(/(\.top|\.tile)?\.webp$/, '.og.jpg');

export function thumbUrl(src: string, opts: { cropHeight: number; width?: number }): string {
  if (isPlaceholderSrc(src)) {
    const sep = src.includes('?') ? '&' : '?';
    return `${src}${sep}h=${opts.cropHeight}`;
  }
  if (IMAGE_TRANSFORMS) {
    const w = opts.width ?? 720;
    return `/cdn-cgi/image/width=${w},fit=crop,gravity=top,format=auto${src}`;
  }
  const device = captureDevice(src);
  if (
    device &&
    !src.endsWith('.top.webp') &&
    opts.cropHeight <= CAPTURE_W[device] * THUMB_TOP[device]
  )
    return topThumbKey(src);
  return src;
}

/** Social-preview image for a real (non-placeholder) capture; returns undefined for placeholders. */
export function ogCaptureSrc(
  shot:
    | { is_placeholder?: boolean; image?: { src: string; is_placeholder?: boolean } }
    | null
    | undefined,
): string | undefined {
  const src = shot?.image?.src;
  if (!src || shot.is_placeholder || shot.image?.is_placeholder || isPlaceholderSrc(src)) {
    return undefined;
  }
  const clean = src.split('?')[0] ?? src;
  if (!/\.(webp|png|jpe?g)$/i.test(clean)) return undefined;
  const device = captureDevice(clean);
  if (device === 'desktop') return ogKey(clean);
  return device ? topThumbKey(clean) : clean;
}
