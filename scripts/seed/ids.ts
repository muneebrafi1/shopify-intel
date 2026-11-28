/// <reference types="node" />
/**
 * Stable ids for seeded entities (stores, apps, themes, app categories), kept in data/curation/ids.json.
 *
 * Why: the remote D1 is updated with row diffs (scripts/ops/d1-sync.ts) to stay inside the free
 * plan's 100k rows written per day. With sequential ids, curating one more store or adding one
 * app shifted every later id and turned a small change into a full rewrite. Existing keys keep
 * their id forever; new keys get max + 1 in the order they are first seen. Pages, screenshots and
 * placeholder sections derive their ids from the store id (see `capturePlanIds`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type IdKind = 'stores' | 'apps' | 'themes' | 'app_categories';
export type IdLedger = Record<IdKind, Record<string, number>>;

export const LEDGER_PATH = 'data/curation/ids.json';

export function readLedger(root: string): IdLedger {
  const p = join(root, LEDGER_PATH);
  const empty: IdLedger = { stores: {}, apps: {}, themes: {}, app_categories: {} };
  if (!existsSync(p)) return empty;
  const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<IdLedger>;
  return { ...empty, ...raw };
}

/** Assigns ids to `keys` (in order), reusing the ledger and appending new keys. Mutates it. */
export function assignIds(ledger: IdLedger, kind: IdKind, keys: readonly string[]) {
  const table = ledger[kind];
  let next = Math.max(0, ...Object.values(table)) + 1;
  const out = new Map<string, number>();
  for (const key of keys) {
    let id = table[key];
    if (id === undefined) {
      id = next++;
      table[key] = id;
    }
    out.set(key, id);
  }
  return out;
}

export function writeLedger(root: string, ledger: IdLedger) {
  const sorted = (t: Record<string, number>) =>
    Object.fromEntries(Object.entries(t).sort((a, b) => a[1] - b[1]));
  const body = {
    _note:
      'Stable seed ids (scripts/seed/ids.ts). Never edit or reuse an id: remote D1 syncs by row diff.',
    stores: sorted(ledger.stores),
    apps: sorted(ledger.apps),
    themes: sorted(ledger.themes),
    app_categories: sorted(ledger.app_categories),
  };
  writeFileSync(join(root, LEDGER_PATH), `${JSON.stringify(body, null, 2)}\n`);
}

/** Room per store / screenshot, so ids never collide as page types and sections grow. */
export const PAGES_PER_STORE = 16;
export const SECTIONS_PER_SHOT = 128;

export const pageIdFor = (storeId: number, pageTypeIndex: number) =>
  storeId * PAGES_PER_STORE + pageTypeIndex;
export const shotIdFor = (pageId: number, deviceIndex: number) => pageId * 2 + deviceIndex;
export const sectionIdFor = (shotId: number, order: number) => shotId * SECTIONS_PER_SHOT + order;
