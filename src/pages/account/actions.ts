/**
 * POST /account/actions — every board change, as plain form posts (no JS needed). Same-origin
 * and a signed-in user are enforced by the middleware; boards need a paid plan.
 *
 * intent: create | rename | delete | save | remove | delete-account
 * Answers with a 303 back to a same-site page plus ?done=… or ?error=… for the notice.
 */
import type { APIRoute } from 'astro';
import { safeNext } from '~/components/static/content';
import { accountDb } from '~/server/account/env';
import { endSession } from '~/server/account/cookies';
import {
  addItem,
  BoardError,
  createBoard,
  deleteBoard,
  isItemType,
  removeItem,
  updateBoard,
} from '~/server/account/boards';
import { isPaid } from '~/server/account/entitlements';
import { deleteUser } from '~/server/account/users';

export const prerender = false;

const withParam = (path: string, key: string, value: string) => {
  const u = new URL(path, 'http://x');
  u.searchParams.set(key, value);
  return `${u.pathname}${u.search}`;
};

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/sign-in', 303);
  const form = await request.formData();
  const get = (k: string) => String(form.get(k) ?? '');
  const intent = get('intent');
  const back = safeNext(get('back'), '/account/boards');
  const db = accountDb();

  if (intent === 'delete-account') {
    if (get('confirm') !== 'delete')
      return redirect(withParam('/account', 'error', 'confirm'), 303);
    await deleteUser(db, user.id);
    await endSession(db, cookies);
    return redirect('/?account_deleted=1', 303);
  }

  if (!isPaid(user.plan)) return redirect('/account/boards?error=plan', 303);

  try {
    switch (intent) {
      case 'create': {
        const board = await createBoard(db, user.id, {
          name: get('name'),
          description: get('description'),
        });
        return redirect(`/account/boards/${board.slug}?done=created`, 303);
      }
      case 'rename': {
        await updateBoard(db, user.id, get('board'), {
          name: get('name'),
          description: get('description'),
        });
        return redirect(`/account/boards/${encodeURIComponent(get('board'))}?done=renamed`, 303);
      }
      case 'delete': {
        await deleteBoard(db, user.id, get('board'));
        return redirect('/account/boards?done=deleted', 303);
      }
      case 'save': {
        const [type = '', ref = ''] = get('item').split(':');
        if (!isItemType(type)) throw new BoardError('unknown_item', 'Unknown item.');
        let slug = get('board');
        if (slug === '__new' || !slug) {
          slug = (await createBoard(db, user.id, { name: get('name') || 'Saved' })).slug;
        }
        const added = await addItem(db, user.id, slug, type, ref);
        return redirect(
          withParam(withParam(back, 'saved', added ? 'added' : 'already'), 'board', slug),
          303,
        );
      }
      case 'remove': {
        const type = get('type');
        const id = Number(get('id'));
        if (!isItemType(type) || !Number.isInteger(id))
          throw new BoardError('invalid', 'Unknown item.');
        await removeItem(db, user.id, get('board'), type, id);
        return redirect(`/account/boards/${encodeURIComponent(get('board'))}?done=removed`, 303);
      }
      default:
        return redirect(withParam(back, 'error', 'intent'), 303);
    }
  } catch (err) {
    if (err instanceof BoardError) return redirect(withParam(back, 'error', err.code), 303);
    throw err;
  }
};
