/**
 * Affiliate links. The API never exposes a referral URL: CTAs point at /go/<id>, which logs an
 * anonymous daily click count and redirects (src/pages/go/[id].ts).
 */
import type { Ctx } from '../api/v1/context.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { Cta } from '../api/v1/schemas/common.ts';
import type { Db } from '../db/types.ts';
import { jsonIds } from './refs.ts';

export const AFFILIATE_DISCLOSURE = 'Affiliate link: we may earn a commission, at no cost to you.';

/** Active affiliate link id per target id. */
export async function activeLinks(
  ctx: Ctx,
  targetType: 'app' | 'theme',
  targetIds: readonly number[],
): Promise<Map<number, number>> {
  if (targetIds.length === 0) return new Map();
  const rows = await ctx.db.all<{ id: number; target_id: number }>(
    `SELECT id, target_id FROM affiliate_links
     WHERE target_type = ? AND active = 1 AND target_id IN (SELECT value FROM json_each(?))
     ORDER BY id`,
    [targetType, jsonIds(targetIds)],
  );
  const out = new Map<number, number>();
  for (const r of rows) if (!out.has(r.target_id)) out.set(r.target_id, r.id);
  return out;
}

export function buildCta(opts: {
  linkId: number | undefined;
  officialUrl: string | null;
  label: string;
}): Cta | null {
  if (opts.linkId !== undefined) {
    return {
      href: hrefs.go(opts.linkId),
      label: opts.label,
      is_affiliate: true,
      rel: 'sponsored nofollow noopener',
      disclosure: AFFILIATE_DISCLOSURE,
    };
  }
  if (!opts.officialUrl) return null;
  return {
    href: opts.officialUrl,
    label: opts.label,
    is_affiliate: false,
    rel: 'noopener',
    disclosure: null,
  };
}

/** The redirect target for /go/<id>, or null when unknown or inactive. */
export async function linkTarget(db: Db, linkId: number): Promise<string | null> {
  const row = await db.first<{ url: string }>(
    'SELECT url FROM affiliate_links WHERE id = ? AND active = 1',
    [linkId],
  );
  return row?.url ?? null;
}

/** Upserts the anonymous per-day click counter. */
export async function recordClick(db: Db, linkId: number, day: string): Promise<void> {
  await db.run(
    `INSERT INTO clicks (link_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT (link_id, day) DO UPDATE SET count = count + 1`,
    [linkId, day],
  );
}

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless/i;

/**
 * /go/<id>: logs one anonymous click for today (GET only, not for obvious bots or link
 * previews) and 302s to the affiliate URL. Unknown or inactive links 404. Never indexed.
 */
export async function affiliateRedirect(
  db: Db,
  idParam: string | undefined,
  request: Request,
  now: Date = new Date(),
): Promise<Response> {
  const headers = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
  const id = Number(idParam);
  const url = Number.isInteger(id) && id > 0 ? await linkTarget(db, id) : null;
  if (!url) {
    return new Response('Link not found', {
      status: 404,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (request.method === 'GET' && !BOT_UA.test(request.headers.get('user-agent') ?? '')) {
    try {
      await recordClick(db, id, now.toISOString().slice(0, 10));
    } catch (err) {
      // Counting must never block the visitor.
      console.error('[go] click not recorded', err);
    }
  }
  return new Response(null, { status: 302, headers: { ...headers, Location: url } });
}
