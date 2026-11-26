/** Seed sizes read from the data, so tests follow curation instead of hard-coding it. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../../..');
const json = <T>(rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;

/** Curated stores (data/curation/stores.json). */
export const CURATED = json<{ stores: unknown[] }>('data/curation/stores.json').stores.length;
/** Every store in the 930-store scan. */
export const SCANNED = json<unknown[]>('data/seed/detections-930.json').length;
/** Placeholder screenshots in a fresh seed: home, collection, product × desktop, mobile. */
export const PLACEHOLDER_SHOTS = CURATED * 3 * 2;
