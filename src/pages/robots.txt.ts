import type { APIRoute } from 'astro';

export const prerender = true;

// Pre-launch previews are built with PUBLIC_NOINDEX=1: nothing may be crawled or indexed.
const NOINDEX = import.meta.env.PUBLIC_NOINDEX === '1';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? '';
  const body = NOINDEX
    ? ['User-agent: *', 'Disallow: /', '']
    : [
        'User-agent: *',
        'Disallow: /admin',
        'Disallow: /api/v1/admin',
        'Disallow: /go/',
        'Disallow: /account',
        'Disallow: /design-system',
        '',
        `Sitemap: ${origin}/sitemap.xml`,
        '',
      ];
  return new Response(body.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
