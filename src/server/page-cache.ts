/**
 * Public catalog page-cache. Catalog data only changes when a batch is ingested, so Astro pages
 * read precomputed JSON from R2 (and Cache API) instead of live D1. /api/v1 and MCP keep using
 * live D1. A miss falls back to the live query.
 *
 * Objects live at page-cache/<version>/<method>/<key>.json. version is the catalog data_version
 * written by scripts/ops/rebuild-page-cache.ts into page-cache/manifest.json.
 */
import type { MediaStore } from './admin/actions.ts';
import type { ApiClient } from './api/v1/client.ts';
import type { CallOptions } from './api/v1/client.ts';

const MANIFEST_KEY = 'page-cache/manifest.json';
const CACHE_ORIGIN = 'https://page-cache.vitrine.internal';
const MANIFEST_TTL_MS = 60_000;

/** Endpoints that are request-specific or write paths: never served from the catalog cache. */
const UNCACHED = new Set(['createRemovalRequest', 'search']);

export interface PageCacheManifest {
  version: string;
  built_at: string;
  counts: Record<string, number>;
}

export interface PageCacheRef {
  type: string;
  key: string;
}

export function pageCacheRef(method: string, input: unknown): PageCacheRef | null {
  if (UNCACHED.has(method)) return null;
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return { type: method, key: stableKey(obj) };
}

export function stableKey(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    } else if (Array.isArray(v)) {
      parts.push(`${k}=${encodeURIComponent(v.map(String).join(','))}`);
    } else {
      parts.push(`${k}=${encodeURIComponent(JSON.stringify(v))}`);
    }
  }
  return parts.join('&') || 'default';
}

export function r2ObjectKey(version: string, type: string, key: string): string {
  return `page-cache/${version}/${type}/${key}.json`;
}

let manifestMemo: { at: number; value: Promise<PageCacheManifest | null> } | null = null;

async function readManifest(store: MediaStore | null): Promise<PageCacheManifest | null> {
  const now = Date.now();
  if (manifestMemo && now - manifestMemo.at < MANIFEST_TTL_MS) return manifestMemo.value;
  const value = (async () => {
    const cached = await cacheGet<PageCacheManifest>(`${CACHE_ORIGIN}/manifest`);
    if (cached) return cached;
    if (!store?.get) return null;
    try {
      const obj = await store.get(MANIFEST_KEY);
      if (!obj) return null;
      const man = JSON.parse(await obj.text()) as PageCacheManifest;
      if (!man?.version) return null;
      await cachePut(`${CACHE_ORIGIN}/manifest`, JSON.stringify(man), 60);
      return man;
    } catch {
      return null;
    }
  })();
  manifestMemo = { at: now, value };
  value.catch(() => {
    manifestMemo = null;
  });
  return value;
}

async function cacheGet<T>(url: string): Promise<T | null> {
  try {
    const hit = await caches.default.match(url);
    if (!hit) return null;
    return (await hit.json()) as T;
  } catch {
    return null;
  }
}

async function cachePut(url: string, body: string, maxAge: number): Promise<void> {
  try {
    await caches.default.put(
      url,
      new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${maxAge}`,
        },
      }),
    );
  } catch {
    // caches.default is missing in tests / some dev runtimes.
  }
}

/** Read a precomputed payload: Cache API, then R2. Null on miss. */
export async function readPageCache<T>(
  store: MediaStore | null,
  type: string,
  key: string,
): Promise<T | null> {
  const man = await readManifest(store);
  if (!man) return null;
  const r2Key = r2ObjectKey(man.version, type, key);
  const cacheUrl = `${CACHE_ORIGIN}/${man.version}/${type}/${encodeURIComponent(key)}`;
  const cached = await cacheGet<T>(cacheUrl);
  if (cached) return cached;
  if (!store?.get) return null;
  try {
    const obj = await store.get(r2Key);
    if (!obj) return null;
    const text = await obj.text();
    await cachePut(cacheUrl, text, 3600);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Wrap a page-facing API client so catalog GETs try R2 / Cache API before D1. */
export function withPageCache(inner: ApiClient, media: () => MediaStore | null): ApiClient {
  const client = {} as ApiClient;
  for (const name of Object.keys(inner) as (keyof ApiClient)[]) {
    const method = name;
    client[method] = (async (input?: unknown, opts?: CallOptions) => {
      const ref = pageCacheRef(String(method), input ?? {});
      if (ref) {
        const hit = await readPageCache(media(), ref.type, ref.key);
        if (hit !== null) return hit;
      }
      const fn = inner[method] as (i?: unknown, o?: CallOptions) => Promise<unknown>;
      return fn(input, opts);
    }) as ApiClient[typeof method];
  }
  return client;
}
