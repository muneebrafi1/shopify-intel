/** Seed sizes read from the data, so tests follow curation instead of hard-coding it. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../../..');
const json = <T>(rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;

/** Curated stores (data/curation/stores.json). */
export const CURATED = json<{ stores: unknown[] }>('data/curation/stores.json').stores.length;
type Detection = { domain: string; theme: string | null; apps: string[] };
const extraFile = join(root, 'data/seed/detections-extra.json');
/** The 930-store scan plus curated stores found later by our own crawl. */
export const DETECTIONS: Detection[] = [
  ...json<Detection[]>('data/seed/detections-930.json'),
  ...(existsSync(extraFile) ? json<Detection[]>('data/seed/detections-extra.json') : []),
];
/** Every scanned store. */
export const SCANNED = DETECTIONS.length;
/** Stores where an app (detection slug) was detected. */
export const appStores = (slug: string) => DETECTIONS.filter((d) => d.apps.includes(slug)).length;
/** Stores on a theme (by detected name, case-insensitive). */
export const themeStores = (name: string) =>
  DETECTIONS.filter((d) => d.theme?.toLowerCase() === name.toLowerCase()).length;
/** Placeholder screenshots in a fresh seed: home, collection, product × desktop, mobile. */
export const PLACEHOLDER_SHOTS = CURATED * 3 * 2;
