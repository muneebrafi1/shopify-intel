import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? '';
  const body = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/v1/admin',
    'Disallow: /go/',
    'Disallow: /account',
    'Disallow: /design-system',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
