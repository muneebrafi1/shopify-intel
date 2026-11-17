/**
 * Drawn placeholder captures, until the capture pipeline lands real images in R2.
 *   /media/placeholder/shot/<id>.svg[?h=<css px>]   whole page, or its top slice (thumbnails)
 *   /media/placeholder/section/<id>.svg             one section, cropped from its page
 * Drawn from the same section rows the UI uses, via the public API (no direct SQL here).
 */
import type { APIRoute } from 'astro';
import { api, orNotFound } from '~/server/api';
import { renderPlaceholderSvg, type PlaceholderSection } from '~/server/media/placeholder-svg';

export const prerender = false;

interface ShotLike {
  device: string;
  width: number;
  height: number;
  page_type: { slug: string };
  store: { domain: string; display_name: string };
  sections: {
    type: { slug: string };
    rect: { x: number; y: number; w: number; h: number };
    hints?: Record<string, unknown> | null;
  }[];
}

const toSections = (shot: ShotLike): PlaceholderSection[] =>
  shot.sections.map((s) => ({
    type: s.type.slug,
    y: s.rect.y,
    height: s.rect.h,
    x: s.rect.x,
    w: s.rect.w,
    hints: s.hints ?? null,
  }));

const svgResponse = (svg: string) =>
  new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Placeholders change only when the seed/layout changes; a day at the browser, a year at the edge.
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

export const GET: APIRoute = async ({ params, url }) => {
  const match = /^(\d+)\.svg$/.exec(params.file ?? '');
  if (!match) return notFound();
  const id = Number(match[1]);

  if (params.kind === 'shot') {
    const res = await orNotFound(api.getScreenshot({ id }));
    if (!res) return notFound();
    const shot = res.data as unknown as ShotLike;
    const h = Number(url.searchParams.get('h'));
    const crop =
      Number.isFinite(h) && h > 0 ? { y: 0, height: Math.min(h, shot.height) } : undefined;
    return svgResponse(
      renderPlaceholderSvg(
        {
          seed: shot.store.domain,
          label: shot.store.display_name,
          device: shot.device === 'mobile' ? 'mobile' : 'desktop',
          pageType: shot.page_type.slug,
          width: shot.width,
          height: shot.height,
          sections: toSections(shot),
        },
        { crop },
      ),
    );
  }

  if (params.kind === 'section') {
    const res = await orNotFound(api.getSection({ id }));
    if (!res) return notFound();
    const { section, screenshot } = res.data as unknown as {
      section: { rect: { x: number; y: number; w: number; h: number } };
      screenshot: ShotLike;
    };
    return svgResponse(
      renderPlaceholderSvg(
        {
          seed: screenshot.store.domain,
          label: screenshot.store.display_name,
          device: screenshot.device === 'mobile' ? 'mobile' : 'desktop',
          pageType: screenshot.page_type.slug,
          width: screenshot.width,
          height: screenshot.height,
          sections: toSections(screenshot),
        },
        {
          crop: {
            y: section.rect.y,
            height: section.rect.h,
            x: section.rect.x,
            width: section.rect.w,
          },
        },
      ),
    );
  }

  return notFound();
};

export const HEAD: APIRoute = GET;
