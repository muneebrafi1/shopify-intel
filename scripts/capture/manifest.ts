/// <reference types="node" />
/**
 * The capture manifest: the latest capture per store × page type × device, in the exact shape
 * ingestCapture() accepts, plus run diagnostics. Written by `npm run capture`, read by
 * `npm run capture:ingest`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CaptureInput } from '../../src/server/repo/ingest.ts';
import { MANIFEST } from './paths.ts';

export interface ManifestEntry {
  capture: CaptureInput;
  diagnostics: {
    full_height: number;
    truncated: boolean;
    device_scale_factor: number;
    dom_sections: number;
    /** Template keys we could not name (kept for improving the rules). */
    unclassified: string[];
  };
}

export interface Manifest {
  version: 1;
  updated_at: string;
  entries: ManifestEntry[];
  failures: Array<{
    domain: string;
    page_type?: string;
    device: string;
    reason: string;
    at: string;
  }>;
}

const keyOf = (c: CaptureInput) => `${c.domain}|${c.page_type}|${c.device}`;

export function readManifest(path = MANIFEST): Manifest {
  if (!existsSync(path))
    return { version: 1, updated_at: new Date(0).toISOString(), entries: [], failures: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

/** Replaces the entry for the same store × page × device (latest capture wins). */
export function upsertEntry(m: Manifest, entry: ManifestEntry): Manifest {
  const k = keyOf(entry.capture);
  const entries = m.entries.filter((e) => keyOf(e.capture) !== k);
  entries.push(entry);
  entries.sort((a, b) => keyOf(a.capture).localeCompare(keyOf(b.capture)));
  const failures = m.failures.filter(
    (f) => `${f.domain}|${f.page_type ?? 'home'}|${f.device}` !== k,
  );
  return { ...m, updated_at: new Date().toISOString(), entries, failures };
}

export function writeManifest(m: Manifest, path = MANIFEST) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
}
