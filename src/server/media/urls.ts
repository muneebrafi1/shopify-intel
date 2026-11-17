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
