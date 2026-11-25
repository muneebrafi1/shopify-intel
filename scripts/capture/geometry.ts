/**
 * Turns classified DOM sections into clean section rectangles on the stored capture:
 * sorted, clipped to the captured height, tiny and overlapping boxes dropped.
 */
import type { SectionType } from '../../src/lib/taxonomy.ts';

export interface Box {
  type: SectionType;
  y: number;
  height: number;
}

/** Sections shorter than this are noise (spacers, empty app wrappers). */
export const MIN_SECTION_HEIGHT = 24;

export function cleanBoxes<T extends Box>(boxes: readonly T[], capturedHeight: number): T[] {
  const out: T[] = [];
  const sorted = [...boxes]
    .map((b) => ({ ...b, y: Math.max(0, Math.round(b.y)), height: Math.round(b.height) }))
    .sort((a, b) => a.y - b.y || b.height - a.height);
  for (const b of sorted) {
    if (b.y >= capturedHeight) continue;
    const height = Math.min(b.height, capturedHeight - b.y);
    if (height < MIN_SECTION_HEIGHT) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const overlap = prev.y + prev.height - b.y;
      // Nested or mostly overlapping (sticky wrappers, duplicated mobile/desktop sections).
      if (overlap > height * 0.5) continue;
      if (overlap > 0) prev.height = b.y - prev.y;
      if (prev.height < MIN_SECTION_HEIGHT) out.pop();
    }
    out.push({ ...b, height });
  }
  return out;
}

/** Compact UTC stamp for R2 keys: 2026-11-25T18:15:02.123Z → 20261125T181502Z. */
export const keyStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export const shotKey = (domain: string, page: string, device: string, capturedAt: string) =>
  `shots/${domain}/${page}/${device}/${keyStamp(capturedAt)}.webp`;

export const cropKey = (
  domain: string,
  page: string,
  device: string,
  capturedAt: string,
  order: number,
  type: string,
) => `crops/${domain}/${page}/${device}/${keyStamp(capturedAt)}/${order}-${type}.webp`;
