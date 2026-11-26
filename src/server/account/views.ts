/**
 * What a board shows: its items resolved to section cards (sections) or link tiles (stores,
 * themes, apps, screenshots), in board order. Items whose target was removed (opt-out, hidden
 * theme) are skipped. Six queries at most, whatever the board size.
 */
import type { Ctx } from '../api/v1/context.ts';
import type { Image, SectionCard } from '../api/v1/schemas/common.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import { screenshotImage } from '../media/urls.ts';
import { jsonIds, pageTypeRef } from '../repo/refs.ts';
import { homePreviews, sectionCards } from '../repo/visual.ts';
import type { BoardItem, ItemType } from './boards.ts';

export type BoardView =
  | { kind: 'section'; type: 'section'; id: number; card: SectionCard }
  | {
      kind: 'link';
      type: Exclude<ItemType, 'section'>;
      id: number;
      href: string;
      title: string;
      meta: string;
      image: Image | null;
      iconUrl: string | null;
    };

const ids = (items: BoardItem[], type: ItemType) =>
  items.filter((i) => i.type === type).map((i) => i.id);

export async function boardViews(ctx: Ctx, items: BoardItem[]): Promise<BoardView[]> {
  const byType = (t: ItemType) => ids(items, t);
  const none = Promise.resolve([] as never[]);
  const [sections, stores, themes, apps, shots] = await Promise.all([
    byType('section').length
      ? sectionCards(ctx, 's.id IN (SELECT value FROM json_each(?))', [jsonIds(byType('section'))])
      : none,
    byType('store').length
      ? ctx.db.all<{ id: number; domain: string; name: string | null }>(
          `SELECT id, domain, name FROM stores WHERE status = 'active'
           AND id IN (SELECT value FROM json_each(?))`,
          [jsonIds(byType('store'))],
        )
      : none,
    byType('theme').length
      ? ctx.db.all<{ id: number; slug: string; name: string; vendor: string | null }>(
          `SELECT id, slug, name, vendor FROM themes WHERE status = 'active'
           AND id IN (SELECT value FROM json_each(?))`,
          [jsonIds(byType('theme'))],
        )
      : none,
    byType('app').length
      ? ctx.db.all<{
          id: number;
          slug: string;
          name: string;
          developer: string | null;
          icon_url: string | null;
        }>(
          `SELECT id, slug, name, developer, icon_url FROM apps WHERE id IN (SELECT value FROM json_each(?))`,
          [jsonIds(byType('app'))],
        )
      : none,
    byType('screenshot').length
      ? ctx.db.all<{
          id: number;
          r2_key: string | null;
          width: number;
          height: number;
          is_placeholder: number;
          page_type: string;
          device: string;
          domain: string;
          name: string | null;
        }>(
          `SELECT sh.id, sh.r2_key, sh.width, sh.height, sh.is_placeholder, sh.page_type, sh.device,
             st.domain, st.name FROM screenshots sh JOIN stores st ON st.id = sh.store_id
           WHERE st.status = 'active' AND sh.id IN (SELECT value FROM json_each(?))`,
          [jsonIds(byType('screenshot'))],
        )
      : none,
  ]);
  const previews = await homePreviews(
    ctx,
    stores.map((s) => s.id),
  );

  const out = new Map<string, BoardView>();
  for (const c of sections)
    out.set(`section:${c.id}`, { kind: 'section', type: 'section', id: c.id, card: c });
  for (const s of stores)
    out.set(`store:${s.id}`, {
      kind: 'link',
      type: 'store',
      id: s.id,
      href: hrefs.store(s.domain),
      title: s.name ?? s.domain,
      meta: `Store · ${s.domain}`,
      image: previews.get(s.id)?.image ?? null,
      iconUrl: null,
    });
  for (const t of themes)
    out.set(`theme:${t.id}`, {
      kind: 'link',
      type: 'theme',
      id: t.id,
      href: hrefs.theme(t.slug),
      title: t.name,
      meta: `Theme${t.vendor ? ` · ${t.vendor}` : ''}`,
      image: null,
      iconUrl: null,
    });
  for (const a of apps)
    out.set(`app:${a.id}`, {
      kind: 'link',
      type: 'app',
      id: a.id,
      href: hrefs.app(a.slug),
      title: a.name,
      meta: `App${a.developer ? ` · ${a.developer}` : ''}`,
      image: null,
      iconUrl: a.icon_url,
    });
  for (const sh of shots)
    out.set(`screenshot:${sh.id}`, {
      kind: 'link',
      type: 'screenshot',
      id: sh.id,
      href: hrefs.store(sh.domain),
      title: sh.name ?? sh.domain,
      meta: `${pageTypeRef(sh.page_type).name} page · ${sh.device}`,
      image: screenshotImage(sh, ctx.media),
      iconUrl: null,
    });
  return items.flatMap((i) => {
    const v = out.get(`${i.type}:${i.id}`);
    return v ? [v] : [];
  });
}

/** First crop of each board's thumbnail sections, for the board cards. */
export async function boardThumbs(ctx: Ctx, sectionIds: number[]): Promise<Map<number, Image>> {
  if (sectionIds.length === 0) return new Map();
  const cards = await sectionCards(ctx, 's.id IN (SELECT value FROM json_each(?))', [
    jsonIds(sectionIds),
  ]);
  return new Map(cards.map((c) => [c.id, c.crop]));
}
