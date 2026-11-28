/**
 * Worker entry: Astro's request handler plus the scheduled crawler (Cron Trigger).
 * wrangler.jsonc points `main` here; everything else is Astro's default server entry.
 *
 * Public GET responses (pages, /media, /api) are stored in caches.default so repeat
 * visits don't re-run SSR or re-fetch R2. That keeps the Worker from 500-ing under
 * modest concurrency and cuts TTFB for LCP.
 */
import server from '@astrojs/cloudflare/entrypoints/server';
import { crawlNext } from './server/crawl/scheduled.ts';

const SKIP =
  /^\/(admin(?:\/|$)|account(?:\/|$)|api\/account(?:\/|$)|api\/auth(?:\/|$)|cdn-cgi(?:\/|$))/;

const cacheableRequest = (request: Request): boolean => {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (SKIP.test(url.pathname)) return false;
  if (request.headers.has('Authorization')) return false;
  const cookie = request.headers.get('Cookie') ?? '';
  if (/(?:^|;\s*)(?:session|__session|sid|auth|cf_auth)=/i.test(cookie)) return false;
  return true;
};

const cacheableResponse = (res: Response): boolean => {
  if (res.status !== 200) return false;
  if (res.headers.has('Set-Cookie')) return false;
  const cc = res.headers.get('Cache-Control') ?? '';
  if (/no-store|private|no-cache/i.test(cc)) return false;
  return /(?:s-maxage|max-age)=[1-9]\d*/i.test(cc);
};

const cacheKey = (request: Request): Request => new Request(request.url, { method: 'GET' });

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    if (!cacheableRequest(request)) {
      return server.fetch(request, env, ctx);
    }
    const key = cacheKey(request);
    const cached = await caches.default.match(key);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Vitrine-Cache', 'HIT');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    const res = await server.fetch(request, env, ctx);
    if (!cacheableResponse(res)) return res;
    const headers = new Headers(res.headers);
    headers.set('X-Vitrine-Cache', 'MISS');
    const miss = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
    ctx.waitUntil(caches.default.put(key, miss.clone()));
    return miss;
  },

  async scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      crawlNext(env, import.meta.env.SITE)
        .catch((e: unknown) => ({ status: 'error', reason: String(e).slice(0, 200) }))
        .then(async (o) => {
          const line = JSON.stringify({ ...o, at: new Date().toISOString() });
          console.log(JSON.stringify({ crawl: o }));
          // The last outcome, so a quiet crawler can be diagnosed from D1 alone (one row write).
          await env.DB.prepare(
            `INSERT INTO meta (key, value, updated_at) VALUES ('crawl_last_outcome', ?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          )
            .bind(line, new Date().toISOString())
            .run();
        }),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
