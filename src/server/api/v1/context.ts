/**
 * Per-call context shared by every handler and repository: the database, environment, the data
 * provenance read from the `meta` table, and request info (HTTP calls only).
 */
import type { Db } from '../../db/types.ts';
import type { MediaOptions } from '../../media/urls.ts';

/** Environment variables the API reads (names documented in .env.example). */
export interface ApiEnv {
  /** Salt for hashing client IPs (rate limiting). Required in production. */
  IP_HASH_SALT?: string;
  /** Absolute origin for captured media, e.g. an R2 custom domain. Optional. */
  MEDIA_BASE_URL?: string;
}

export interface Source {
  label: string;
  as_of: string;
  url: string | null;
}

export const SOURCE_IDS = {
  appStore: 'shopify-app-store',
  editorial: 'editorial',
  capturePlan: 'capture-plan',
} as const;

/** Data provenance, from the `meta` table. */
export interface DataInfo {
  dataVersion: string;
  dataAsOf: string;
  scanSourceId: string;
  scanSourceLabel: string;
  rulesVersion: string | null;
  scannedTotal: number;
  appStoreCheckedFrom: string | null;
  appStoreCheckedTo: string | null;
  sources: Record<string, Source>;
}

export interface RequestInfo {
  /** Client IP from CF-Connecting-IP; null in-process. Never stored raw. */
  ip: string | null;
}

export interface Ctx {
  db: Db;
  env: ApiEnv;
  data: DataInfo;
  media: MediaOptions;
  now: () => Date;
  request: RequestInfo | null;
}

export async function loadDataInfo(db: Db): Promise<DataInfo> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM meta');
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const dataAsOf = m.get('data_as_of') ?? '1970-01-01';
  const scanSourceId = m.get('source_id') ?? 'scan';
  const scanSourceLabel = m.get('source_label') ?? 'Store scan';
  const appStoreCheckedTo = m.get('app_store_checked_to') ?? null;
  return {
    dataVersion: m.get('data_version') ?? 'empty',
    dataAsOf,
    scanSourceId,
    scanSourceLabel,
    rulesVersion: m.get('rules_version') ?? null,
    scannedTotal: Number(m.get('scanned_total') ?? 0),
    appStoreCheckedFrom: m.get('app_store_checked_from') ?? null,
    appStoreCheckedTo,
    sources: {
      [scanSourceId]: { label: scanSourceLabel, as_of: dataAsOf, url: '/methodology' },
      [SOURCE_IDS.appStore]: {
        label: 'Shopify App Store listing',
        as_of: appStoreCheckedTo ?? dataAsOf,
        url: 'https://apps.shopify.com',
      },
      [SOURCE_IDS.editorial]: { label: 'Editorial', as_of: dataAsOf, url: null },
      [SOURCE_IDS.capturePlan]: {
        label: 'Planned capture layout (placeholder, not a real screenshot)',
        as_of: dataAsOf,
        url: '/methodology',
      },
    },
  };
}

/** Caches DataInfo per isolate for a short TTL so each call does not re-read `meta`. */
export function dataInfoCache(ttlMs: number): (db: Db, now: number) => Promise<DataInfo> {
  let cached: { at: number; value: Promise<DataInfo> } | null = null;
  return (db, now) => {
    if (!cached || now - cached.at > ttlMs) {
      const value = loadDataInfo(db);
      cached = { at: now, value };
      value.catch(() => {
        cached = null;
      });
    }
    return cached.value;
  };
}
