/**
 * Worker entry: Astro's request handler plus the scheduled crawler (Cron Trigger).
 * wrangler.jsonc points `main` here; everything else is Astro's default server entry.
 */
import server from '@astrojs/cloudflare/entrypoints/server';
import { crawlNext } from './server/crawl/scheduled.ts';

export default {
  fetch: server.fetch,
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
