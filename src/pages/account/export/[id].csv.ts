/** GET /account/export/<board>.csv — one board as CSV (Pro: exports). Owner-scoped. */
import type { APIRoute } from 'astro';
import { accountDb } from '~/server/account/env';
import { boardCsv, getBoard } from '~/server/account/boards';
import { isPaid } from '~/server/account/entitlements';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user || !isPaid(user.plan)) return new Response('Not found', { status: 404 });
  const db = accountDb();
  const board = await getBoard(db, user.id, String(params.id ?? ''));
  if (!board) return new Response('Not found', { status: 404 });
  return new Response(await boardCsv(db, board.id), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${board.slug}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
