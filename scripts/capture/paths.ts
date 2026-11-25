/// <reference types="node" />
/** Where the local pipeline keeps its output (gitignored, like the rest of .data/). */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CAPTURE_DIR = join(ROOT, '.data/captures');
/** Mirror of the R2 bucket layout: objects/<r2 key>. */
export const OBJECTS_DIR = join(CAPTURE_DIR, 'objects');
export const MANIFEST = join(CAPTURE_DIR, 'manifest.json');
export const objectPath = (key: string) => join(OBJECTS_DIR, key);
