/**
 * Glue for admin pages: the action context for the signed-in admin and the POST → redirect
 * (Post/Redirect/Get) flow with a flash message.
 */
import type { AstroGlobal } from 'astro';
import type { ActionContext, ActionResult } from './actions.ts';
import { adminDb, adminEnv } from './env.ts';
import { flashHref } from './flash.ts';
import { FormError, readForm } from './forms.ts';

export function actionContext(astro: AstroGlobal): ActionContext {
  const session = astro.locals.admin;
  // The middleware guarantees a session on admin pages; this is defence in depth.
  if (!session) throw new Error('admin action without a session');
  return {
    db: adminDb(),
    actor: session.actor,
    now: new Date(),
    media: adminEnv().MEDIA ?? null,
  };
}

export type ActionHandler = (
  form: FormData,
  ctx: ActionContext,
) => Promise<ActionResult & { redirect?: string }>;

/** Reads the form, runs the handler and redirects (303) back with a flash key. */
export async function runAction(astro: AstroGlobal, handler: ActionHandler): Promise<Response> {
  const ctx = actionContext(astro);
  let result: ActionResult & { redirect?: string };
  try {
    result = await handler(await readForm(astro.request), ctx);
  } catch (err) {
    if (err instanceof FormError) result = { ok: false, flash: err.flash };
    else throw err;
  }
  const back = result.redirect ?? `${astro.url.pathname}${astro.url.search}`;
  return astro.redirect(flashHref(back, result), 303);
}

/** Positive integer from a route param or query value, else null. */
export function idParam(value: string | null | undefined): number | null {
  return value && /^\d{1,12}$/.test(value) ? Number(value) : null;
}
