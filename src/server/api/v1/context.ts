/**
 * Per-call context shared by every handler and repository: the database, environment, the data
 * provenance read from the `meta` table, and request info (HTTP calls only).
 */
import type { MediaStore } from '../../admin/actions.ts';
import type { Db } from '../../db/types.ts';
import type { MediaOptions } from '../../media/urls.ts';
import type { Notifier, WaitUntil } from '../../notify.ts';

/** Environment variables the API reads (names documented in .env.example). */
export interface ApiEnv {
  /** Salt for hashing client IPs (rate limiting). Required in production. */
  IP_HASH_SALT?: string;
  /** Absolute origin for captured media, e.g. an R2 custom domain. Optional. */
  MEDIA_BASE_URL?: string;
  /** Recipient of admin notifications (new removal requests). Optional; see notify.ts. */
  ADMIN_NOTIFY_EMAIL?: string;
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
  themeStore: 'shopify-theme-store',
  crawl: 'vitrine-crawl', // = scans.source written by scripts/crawl (npm run crawl)
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
  /** Latest scan ingested from our own storefront crawl (POST /admin/scans); null if none. */
  crawlLastAt: string | null;
  themeStoreCheckedTo: string | null;
  sources: Record<string, Source>;
}

/** Who is calling a guarded (admin) endpoint, as established by the mount's guard. */
export interface Principal {
  /** Written to the audit log: an Access email, 'admin' (password) or 'api-token'. */
  actor: string;
  method: 'access' | 'password' | 'token';
}

export interface RequestInfo {
  /** Client IP from CF-Connecting-IP; null in-process. Never stored raw. */
  ip: string | null;
  /** Set only on guarded (admin) routes, after the guard allowed the request. */
  principal?: Principal | null;
}

export interface Ctx {
  db: Db;
  env: ApiEnv;
  data: DataInfo;
  media: MediaOptions;
  now: () => Date;
  request: RequestInfo | null;
  /** Admin notifications (src/server/notify.ts). Never throws. */
  notifier: Notifier;
  /** Workers `waitUntil` for work after the response; null in tests and scripts. */
  waitUntil: WaitUntil | null;
  /** R2 subset used to delete media (admin removals); null when unbound. */
  mediaStore: MediaStore | null;
}

export async function loadDataInfo(db: Db): Promise<DataInfo> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM meta');
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const crawlLastAt = m.get('crawl_last_at') ?? null;
  // The latest scan in the data: the seed scan, or our own crawl once it has run since.
  const seededAsOf = m.get('data_as_of') ?? '1970-01-01';
  const crawlDay = crawlLastAt?.slice(0, 10) ?? null;
  const dataAsOf = crawlDay && crawlDay > seededAsOf ? crawlDay : seededAsOf;
  const scanSourceId = m.get('source_id') ?? 'scan';
  const scanSourceLabel = m.get('source_label') ?? 'Store scan';
  const appStoreCheckedTo = m.get('app_store_checked_to') ?? null;
  const themeStoreCheckedTo = m.get('theme_store_checked_to') ?? null;
  return {
    dataVersion: m.get('data_version') ?? 'empty',
    dataAsOf,
    scanSourceId,
    scanSourceLabel,
    rulesVersion: m.get('rules_version') ?? null,
    scannedTotal: Number(m.get('scanned_total') ?? 0),
    appStoreCheckedFrom: m.get('app_store_checked_from') ?? null,
    appStoreCheckedTo,
    crawlLastAt,
    themeStoreCheckedTo,
    sources: {
      [scanSourceId]: { label: scanSourceLabel, as_of: seededAsOf, url: '/methodology' },
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
      ...(themeStoreCheckedTo
        ? {
            [SOURCE_IDS.themeStore]: {
              label: 'Shopify Theme Store page',
              as_of: themeStoreCheckedTo,
              url: 'https://themes.shopify.com',
            },
          }
        : {}),
      ...(crawlLastAt
        ? {
            [SOURCE_IDS.crawl]: {
              label: 'Our storefront crawl',
              as_of: crawlLastAt.slice(0, 10),
              url: '/methodology',
            },
          }
        : {}),
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
