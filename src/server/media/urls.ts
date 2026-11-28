/**
 * Media URL helpers. Captured media is served from R2 by src/pages/media/[...key].ts (or a CDN
 * origin when MEDIA_BASE_URL is set); anything not captured yet is drawn by the placeholder SVG
 * endpoints (/media/placeholder/...), which render from the section rows.
 */
import type { Image } from '../api/v1/schemas/common.ts';

export interface MediaOptions {
  /** Optional absolute origin for captured media (e.g. an R2 custom domain). No trailing slash. */
  baseUrl?: string | null;
}

const mediaPath = (key: string, opts: MediaOptions) => {
  const clean = key.replace(/^\/+/, '');
  return opts.baseUrl ? `${opts.baseUrl.replace(/\/+$/, '')}/${clean}` : `/media/${clean}`;
};

export interface ScreenshotMediaRow {
  id: number;
  r2_key: string | null;
  width: number;
  height: number;
  is_placeholder: number;
}

export function screenshotImage(row: ScreenshotMediaRow, opts: MediaOptions = {}): Image {
  const captured = row.r2_key !== null && row.is_placeholder === 0;
  return {
    src:
      captured && row.r2_key
        ? mediaPath(row.r2_key, opts)
        : `/media/placeholder/shot/${row.id}.svg`,
    width: row.width,
    height: row.height,
    is_placeholder: !captured,
  };
}

export interface SectionMediaRow {
  id: number;
  r2_key_crop: string | null;
  height: number;
  w: number | null;
  is_placeholder: number;
}

/** Crop image for a section; `shotWidth` is used when the section spans the full width. */
export function sectionCropImage(
  row: SectionMediaRow,
  shotWidth: number,
  opts: MediaOptions = {},
): Image {
  const captured = row.r2_key_crop !== null && row.is_placeholder === 0;
  return {
    src:
      captured && row.r2_key_crop
        ? mediaPath(row.r2_key_crop, opts)
        : `/media/placeholder/section/${row.id}.svg`,
    width: row.w ?? shotWidth,
    height: row.height,
    is_placeholder: !captured,
  };
}

/**
 * For responses that leave the site (public API, MCP): turn root-relative `/media/...` values of
 * icon_url, logo_url and image `src` into absolute URLs so clients can load them directly.
 * Pages keep the relative form. Returns a new tree; the input is not mutated.
 */
const MEDIA_KEYS = new Set(['icon_url', 'logo_url', 'src']);
export function absolutizeMedia<T>(value: T, origin: string): T {
  const base = origin.replace(/\/+$/, '');
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      return key && MEDIA_KEYS.has(key) && v.startsWith('/media/') ? `${base}${v}` : v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, k);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
