import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { d1Db } from '~/server/db/d1';
import { buildSectionsSitemap } from '~/server/repo/sitemap';

export const prerender = false;

export const GET: APIRoute = async ({ site, url }) => {
  const xml = await buildSectionsSitemap(d1Db(env.DB), (site ?? url).origin);
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
};

export const HEAD: APIRoute = GET;
