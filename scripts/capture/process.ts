/// <reference types="node" />
/**
 * From a raw page capture to stored objects + a manifest entry: classify the DOM sections,
 * clean their boxes, encode the full page, its pre-cut top thumbnail and every section crop as
 * WebP. Stitched captures (viewport tiles) are composited here first.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { THUMB_TOP, THUMB_TOP_PX, topThumbKey } from '../../src/lib/media.ts';
import type { SectionType } from '../../src/lib/taxonomy.ts';
import type { CapturePageType, PageCapture } from './browser.ts';
import { classifySection, type Classified } from './classify.ts';
import { cleanBoxes, cropKey, shotKey } from './geometry.ts';
import type { ManifestEntry } from './manifest.ts';
import { objectPath } from './paths.ts';

const WEBP = { quality: 78, effort: 4 } as const;

export interface DetectedSection extends Omit<Classified, 'type'> {
  type: SectionType;
  y: number;
  height: number;
  x: number;
  w: number | null;
  column: 'left' | 'right' | null;
}

/**
 * Product sections with a detected gallery + buy box become two sections: side by side on
 * desktop (same row, `column` hints), stacked on mobile. Without a gallery the whole section
 * stays one buy box.
 */
function expandSplit(
  s: DetectedSection,
  split: NonNullable<PageCapture['sections'][number]['split']>,
  width: number,
): DetectedSection[] {
  const g = split.gallery;
  if (!g) return [s];
  const b = split.buy;
  // Side by side only on wide pages (mobile always stacks), and only with a sane column cut:
  // off-screen drawers or zero-width boxes keep the section whole.
  const sideBySide = width >= 768 && (g.x + g.w <= b.x + 4 || g.x >= b.x + b.w - 4);
  if (sideBySide) {
    const galleryLeft = g.x < b.x;
    const mid = Math.round(galleryLeft ? b.x : g.x);
    if (mid < width * 0.2 || mid > width * 0.8) return [s];
    const left = { x: 0, w: mid };
    const right = { x: mid, w: width - mid };
    return [
      {
        ...s,
        type: 'product-gallery',
        ...(galleryLeft ? left : right),
        column: galleryLeft ? 'left' : 'right',
      },
      {
        ...s,
        type: 'buy-box',
        ...(galleryLeft ? right : left),
        column: galleryLeft ? 'right' : 'left',
      },
    ];
  }
  if (s.height < 200 || g.h < 50) return [s];
  const cut = Math.round(Math.min(Math.max(g.y + g.h, s.y + 50), s.y + s.height - 50));
  return [
    { ...s, type: 'product-gallery', height: cut - s.y },
    { ...s, type: 'buy-box', y: cut, height: s.y + s.height - cut },
  ];
}

export function detectSections(
  capture: Pick<PageCapture, 'sections' | 'height'> & { width?: number },
  storeApps: readonly string[],
  pageType: CapturePageType = 'home',
): { sections: DetectedSection[]; unclassified: string[] } {
  const visible = capture.sections.filter((s) => s.height >= 1);
  const unclassified: string[] = [];
  const found: Array<DetectedSection & { raw: (typeof visible)[number] }> = [];
  let templateIndex = 0;
  for (const raw of visible) {
    const hit = classifySection(raw, { templateIndex, storeApps, pageType });
    if (hit?.parsed.group === 'template' || (!hit && /template--/.test(raw.id))) templateIndex += 1;
    if (hit) found.push({ ...hit, y: raw.y, height: raw.height, x: 0, w: null, column: null, raw });
    else unclassified.push(raw.id.replace(/^shopify-section-/, ''));
  }
  const width = capture.width ?? 1440;
  const sections = cleanBoxes(found, capture.height).flatMap(({ raw, ...s }) =>
    s.type === 'buy-box' && raw.split ? expandSplit(s, raw.split, width) : [s],
  );
  return { sections, unclassified };
}

function save(key: string, data: Buffer) {
  const path = objectPath(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** One PNG for the whole capture: as shot, or stitched from viewport tiles. */
async function fullPng(capture: PageCapture): Promise<Buffer> {
  if (capture.png) return capture.png;
  const dpr = capture.deviceScaleFactor;
  const width = Math.round(capture.width * dpr);
  const height = Math.round(capture.height * dpr);
  const tiles = (capture.tiles ?? []).filter((t) => t.y < capture.height);
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite(
      await Promise.all(
        tiles.map(async (t) => {
          const top = Math.round(t.y * dpr);
          const meta = await sharp(t.png).metadata();
          const h = Math.min(meta.height ?? 0, height - top);
          const input = await sharp(t.png)
            .extract({ left: 0, top: 0, width: Math.min(meta.width ?? width, width), height: h })
            .toBuffer();
          return { input, left: 0, top };
        }),
      ),
    )
    .png()
    .toBuffer();
}

/** The pre-cut top thumbnail grids use instead of the full page (see src/lib/media.ts). */
export async function topThumb(full: Buffer, device: 'desktop' | 'mobile', cssWidth: number) {
  const img = sharp(full, { limitInputPixels: false });
  const meta = await img.metadata();
  const pxW = meta.width ?? cssWidth;
  const scale = pxW / cssWidth;
  const h = Math.min(meta.height ?? 0, Math.round(cssWidth * THUMB_TOP[device] * scale));
  return sharp(full, { limitInputPixels: false })
    .extract({ left: 0, top: 0, width: pxW, height: h })
    .resize({ width: THUMB_TOP_PX[device] })
    .webp(WEBP)
    .toBuffer();
}

export async function processCapture(opts: {
  domain: string;
  device: 'desktop' | 'mobile';
  pageType?: CapturePageType;
  capture: PageCapture;
  capturedAt: string;
  storeApps: readonly string[];
}): Promise<ManifestEntry> {
  const { domain, device, capture, capturedAt } = opts;
  const page = opts.pageType ?? 'home';
  const { sections, unclassified } = detectSections(capture, opts.storeApps, page);

  const dpr = capture.deviceScaleFactor;
  const png = await fullPng(capture);
  const full = sharp(png, { limitInputPixels: false });
  const meta = await full.metadata();
  const pxW = meta.width ?? Math.round(capture.width * dpr);
  const pxH = meta.height ?? Math.round(capture.height * dpr);

  const r2Key = shotKey(domain, page, device, capturedAt);
  const webp = await full.clone().webp(WEBP).toBuffer();
  save(r2Key, webp);
  save(topThumbKey(r2Key), await topThumb(png, device, capture.width));

  const out: ManifestEntry['capture']['sections'] = [];
  for (const [order, s] of sections.entries()) {
    const top = Math.min(pxH - 1, Math.round(s.y * dpr));
    const height = Math.max(1, Math.min(pxH - top, Math.round(s.height * dpr)));
    const left = Math.min(pxW - 1, Math.round(s.x * dpr));
    const width = s.w === null ? pxW : Math.max(1, Math.min(pxW - left, Math.round(s.w * dpr)));
    const key = cropKey(domain, page, device, capturedAt, order, s.type);
    save(
      key,
      await sharp(png, { limitInputPixels: false })
        .extract({ left, top, width, height })
        .webp(WEBP)
        .toBuffer(),
    );
    out.push({
      type: s.type,
      y: Math.round(s.y),
      height: Math.round(s.height),
      x: Math.round(s.x),
      w: s.w === null ? null : Math.round(s.w),
      app_slug: s.appSlug,
      r2_key_crop: key,
      theme_section_name: s.parsed.key,
      hints: {
        source: 'dom',
        classified_by: s.by,
        ...(s.column ? { column: s.column } : {}),
        ...(capture.tiles ? { capture: 'stitched' } : {}),
      },
    });
  }

  return {
    capture: {
      domain,
      page_type: page,
      device,
      url: capture.url,
      viewport_w: capture.width,
      width: capture.width,
      height: capture.height,
      bytes: webp.length,
      r2_key: r2Key,
      captured_at: capturedAt,
      sections: out,
    },
    diagnostics: {
      full_height: capture.fullHeight,
      truncated: capture.truncated,
      device_scale_factor: dpr,
      dom_sections: capture.sections.length,
      unclassified,
    },
  };
}
