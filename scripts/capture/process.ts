/// <reference types="node" />
/**
 * From a raw page capture to stored objects + a manifest entry: classify the DOM sections,
 * clean their boxes, encode the full page and every section crop as WebP.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import type { PageCapture } from './browser.ts';
import { classifySection, type Classified } from './classify.ts';
import { cleanBoxes, cropKey, shotKey } from './geometry.ts';
import type { ManifestEntry } from './manifest.ts';
import { objectPath } from './paths.ts';

const WEBP = { quality: 78, effort: 4 } as const;

export interface DetectedSection extends Classified {
  y: number;
  height: number;
}

export function detectSections(
  capture: Pick<PageCapture, 'sections' | 'height'>,
  storeApps: readonly string[],
): { sections: DetectedSection[]; unclassified: string[] } {
  const visible = capture.sections.filter((s) => s.height >= 1);
  const unclassified: string[] = [];
  const found: DetectedSection[] = [];
  let templateIndex = 0;
  for (const raw of visible) {
    const hit = classifySection(raw, { templateIndex, storeApps });
    if (
      hit?.parsed.group === 'template' ||
      (!hit && /__/.test(raw.id) && /template--/.test(raw.id))
    )
      templateIndex += 1;
    if (hit) found.push({ ...hit, y: raw.y, height: raw.height });
    else unclassified.push(raw.id.replace(/^shopify-section-/, ''));
  }
  return { sections: cleanBoxes(found, capture.height), unclassified };
}

function save(key: string, data: Buffer) {
  const path = objectPath(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export async function processCapture(opts: {
  domain: string;
  device: 'desktop' | 'mobile';
  capture: PageCapture;
  capturedAt: string;
  storeApps: readonly string[];
}): Promise<ManifestEntry> {
  const { domain, device, capture, capturedAt } = opts;
  const page = 'home';
  const { sections, unclassified } = detectSections(capture, opts.storeApps);

  const dpr = capture.deviceScaleFactor;
  const full = sharp(capture.png, { limitInputPixels: false });
  const meta = await full.metadata();
  const pxW = meta.width ?? Math.round(capture.width * dpr);
  const pxH = meta.height ?? Math.round(capture.height * dpr);

  const r2Key = shotKey(domain, page, device, capturedAt);
  const webp = await full.clone().webp(WEBP).toBuffer();
  save(r2Key, webp);

  const out: ManifestEntry['capture']['sections'] = [];
  for (const [order, s] of sections.entries()) {
    const top = Math.min(pxH - 1, Math.round(s.y * dpr));
    const height = Math.max(1, Math.min(pxH - top, Math.round(s.height * dpr)));
    const key = cropKey(domain, page, device, capturedAt, order, s.type);
    save(
      key,
      await sharp(capture.png, { limitInputPixels: false })
        .extract({ left: 0, top, width: pxW, height })
        .webp(WEBP)
        .toBuffer(),
    );
    out.push({
      type: s.type,
      y: s.y,
      height: s.height,
      x: 0,
      w: null,
      app_slug: s.appSlug,
      r2_key_crop: key,
      theme_section_name: s.parsed.key,
      hints: { source: 'dom', classified_by: s.by },
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
