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
      crawlNext(env, import.meta.env.SITE).then((o) => console.log(JSON.stringify({ crawl: o }))),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
