/**
 * Public catalog page-cache. Catalog data only changes when a batch is ingested, so Astro pages
 * read precomputed JSON from R2 (and Cache API) instead of live D1. /api/v1 and MCP keep using
 * live D1. A miss falls back to the live query.
 *
 * Objects live at page-cache/<version>/<method>/<key>.json. version is the catalog data_version
 * written by scripts/ops/rebuild-page-cache.ts into page-cache/manifest.json.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { MediaStore } from './admin/actions.ts';
import type { ApiClient } from './api/v1/client.ts';
import type { CallOptions } from './api/v1/client.ts';

const MANIFEST_KEY = 'page-cache/manifest.json';
const CACHE_ORIGIN = 'https://page-cache.vitrine.internal';

type PageCacheSource = 'cache' | 'r2' | 'miss';
const pageCacheAls = new AsyncLocalStorage<{ sources: PageCacheSource[] }>();

/** Run a request so catalog reads can record Cache / R2 / D1 fallback. */
export function withPageCacheContext<T>(fn: () => T): T {
  return pageCacheAls.run({ sources: [] }, fn);
}

function notePageCache(source: PageCacheSource): void {
  pageCacheAls.getStore()?.sources.push(source);
}

/** Header value for this request: R2, CACHE, MISS, or MIXED. */
export function pageCacheHeaderValue(): string | undefined {
  const sources = pageCacheAls.getStore()?.sources;
  if (!sources?.length) return undefined;
  const set = new Set(sources);
  if (set.has('miss') && (set.has('r2') || set.has('cache'))) return 'MIXED';
  if (set.has('miss')) return 'MISS';
  if (set.has('r2') && !set.has('cache')) return 'R2';
  if (set.has('cache') && !set.has('r2')) return 'CACHE';
  return 'R2';
}

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

/** Filename-safe cache key; long keys are hashed so R2/FS paths stay short. */
export function safeCacheKey(key: string): string {
  if (key.length <= 160) return key;
  return `h_${cyrb64(key)}_${key.length}`;
}

function cyrb64(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function r2ObjectKey(version: string, type: string, key: string): string {
  return `page-cache/${version}/${type}/${safeCacheKey(key)}.json`;
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
  const cacheUrl = `${CACHE_ORIGIN}/${man.version}/${type}/${encodeURIComponent(safeCacheKey(key))}`;
  const cached = await cacheGet<T>(cacheUrl);
  if (cached) {
    notePageCache('cache');
    return cached;
  }
  if (!store?.get) return null;
  try {
    const obj = await store.get(r2Key);
    if (!obj) return null;
    const text = await obj.text();
    await cachePut(cacheUrl, text, 3600);
    notePageCache('r2');
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
        notePageCache('miss');
      }
      const fn = inner[method] as (i?: unknown, o?: CallOptions) => Promise<unknown>;
      return fn(input, opts);
    }) as ApiClient[typeof method];
  }
  return client;
}
