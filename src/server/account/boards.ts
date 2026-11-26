/**
 * Boards: a signed-in Pro user's saved stores, themes, apps, screenshots and sections
 * (tables collections + collection_items, migrations/0001_init.sql). Every query is scoped by
 * user id, so one user can never read or change another user's board.
 *
 * Items are saved by their public reference (store domain, theme/app slug, section/screenshot
 * id) and stored by numeric id; a reference that does not resolve to a public row is refused.
 */
import type { Db } from '../db/types.ts';
import { slugify } from '../lib/slug.ts';

export const ITEM_TYPES = ['section', 'screenshot', 'store', 'theme', 'app'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const MAX_BOARDS = 50;
export const MAX_ITEMS_PER_BOARD = 500;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 280;

export class BoardError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid' | 'limit' | 'unknown_item',
    message: string,
  ) {
    super(message);
  }
}

export interface Board {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  count: number;
  updatedAt: string;
  /** Up to three section ids, newest first, for the card mosaic. */
  thumbSectionIds: number[];
}

export interface BoardItem {
  type: ItemType;
  id: number;
  note: string | null;
  addedAt: string;
}

export const isItemType = (v: unknown): v is ItemType =>
  typeof v === 'string' && (ITEM_TYPES as readonly string[]).includes(v);

const cleanName = (v: string) => v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const cleanText = (v: string | null | undefined, max: number) => {
  const t = (v ?? '').trim().slice(0, max);
  return t || null;
};

interface BoardRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  updated_at: string;
  n: number;
  thumbs: string | null;
}

const BOARD_SELECT = `SELECT c.id, c.slug, c.name, c.description, c.updated_at,
    (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS n,
    (SELECT json_group_array(item_id) FROM (SELECT item_id FROM collection_items i
       WHERE i.collection_id = c.id AND i.item_type = 'section'
       ORDER BY i.added_at DESC, i.position DESC LIMIT 3)) AS thumbs
  FROM collections c`;

const toBoard = (r: BoardRow): Board => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  count: r.n,
  updatedAt: r.updated_at,
  thumbSectionIds: r.thumbs ? (JSON.parse(r.thumbs) as number[]) : [],
});

export async function listBoards(db: Db, userId: number): Promise<Board[]> {
  const rows = await db.all<BoardRow>(
    `${BOARD_SELECT} WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`,
    [userId, MAX_BOARDS],
  );
  return rows.map(toBoard);
}

export async function getBoard(db: Db, userId: number, slug: string): Promise<Board | null> {
  const r = await db.first<BoardRow>(`${BOARD_SELECT} WHERE c.user_id = ? AND c.slug = ?`, [
    userId,
    slug,
  ]);
  return r ? toBoard(r) : null;
}

export async function createBoard(
  db: Db,
  userId: number,
  input: { name: string; description?: string | null },
  now: Date = new Date(),
): Promise<Board> {
  const name = cleanName(input.name);
  if (!name) throw new BoardError('invalid', 'Give the board a name.');
  const taken = await db.all<{ slug: string }>('SELECT slug FROM collections WHERE user_id = ?', [
    userId,
  ]);
  if (taken.length >= MAX_BOARDS)
    throw new BoardError('limit', `You can have up to ${MAX_BOARDS} boards.`);
  const used = new Set(taken.map((t) => t.slug));
  // 'example-…' is reserved for the example boards shown to visitors.
  let base = slugify(name).slice(0, 48).replace(/-+$/, '') || 'board';
  if (base.startsWith('example')) base = `my-${base}`;
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  const at = now.toISOString();
  await db.run(
    `INSERT INTO collections (user_id, slug, name, description, is_public, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [userId, slug, name, cleanText(input.description, DESCRIPTION_MAX), at, at],
  );
  const board = await getBoard(db, userId, slug);
  if (!board) throw new Error('board insert failed');
  return board;
}

export async function updateBoard(
  db: Db,
  userId: number,
  slug: string,
  input: { name: string; description?: string | null },
  now: Date = new Date(),
): Promise<void> {
  const name = cleanName(input.name);
  if (!name) throw new BoardError('invalid', 'Give the board a name.');
  const res = await db.run(
    'UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE user_id = ? AND slug = ?',
    [name, cleanText(input.description, DESCRIPTION_MAX), now.toISOString(), userId, slug],
  );
  if (res.changes === 0) throw new BoardError('not_found', 'Board not found.');
}

export async function deleteBoard(db: Db, userId: number, slug: string): Promise<void> {
  const b = await db.first<{ id: number }>(
    'SELECT id FROM collections WHERE user_id = ? AND slug = ?',
    [userId, slug],
  );
  if (!b) throw new BoardError('not_found', 'Board not found.');
  await db.batch([
    { sql: 'DELETE FROM collection_items WHERE collection_id = ?', params: [b.id] },
    { sql: 'DELETE FROM collections WHERE id = ?', params: [b.id] },
  ]);
}

/** Numeric id of a public item from its reference, or null. */
export async function resolveItem(db: Db, type: ItemType, ref: string): Promise<number | null> {
  const r = ref.trim();
  if (!r || r.length > 253) return null;
  const sql: Record<ItemType, string> = {
    section: `SELECT s.id FROM sections s JOIN stores st ON st.id = s.store_id AND st.status = 'active' WHERE s.id = ?`,
    screenshot: `SELECT sh.id FROM screenshots sh JOIN stores st ON st.id = sh.store_id AND st.status = 'active' WHERE sh.id = ?`,
    store: `SELECT id FROM stores WHERE domain = ? AND status = 'active'`,
    theme: `SELECT id FROM themes WHERE slug = ? AND status = 'active'`,
    app: `SELECT id FROM apps WHERE slug = ?`,
  };
  const numeric = type === 'section' || type === 'screenshot';
  if (numeric && !/^\d{1,12}$/.test(r)) return null;
  const row = await db.first<{ id: number }>(sql[type], [numeric ? Number(r) : r.toLowerCase()]);
  return row?.id ?? null;
}

/** Adds an item (idempotent: saving it twice keeps one). Returns false when it was already there. */
export async function addItem(
  db: Db,
  userId: number,
  slug: string,
  type: ItemType,
  ref: string,
  now: Date = new Date(),
): Promise<boolean> {
  const board = await db.first<{ id: number; n: number }>(
    `SELECT c.id, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS n
     FROM collections c WHERE c.user_id = ? AND c.slug = ?`,
    [userId, slug],
  );
  if (!board) throw new BoardError('not_found', 'Board not found.');
  const itemId = await resolveItem(db, type, ref);
  if (itemId === null) throw new BoardError('unknown_item', 'That item is no longer available.');
  if (board.n >= MAX_ITEMS_PER_BOARD)
    throw new BoardError('limit', `A board holds up to ${MAX_ITEMS_PER_BOARD} items.`);
  const at = now.toISOString();
  const [ins] = await db.batch([
    {
      sql: `INSERT OR IGNORE INTO collection_items (collection_id, item_type, item_id, position, added_at)
            VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_items WHERE collection_id = ?), ?)`,
      params: [board.id, type, itemId, board.id, at],
    },
    { sql: 'UPDATE collections SET updated_at = ? WHERE id = ?', params: [at, board.id] },
  ]);
  return (ins?.changes ?? 0) > 0;
}

export async function removeItem(
  db: Db,
  userId: number,
  slug: string,
  type: ItemType,
  itemId: number,
  now: Date = new Date(),
): Promise<void> {
  const board = await db.first<{ id: number }>(
    'SELECT id FROM collections WHERE user_id = ? AND slug = ?',
    [userId, slug],
  );
  if (!board) throw new BoardError('not_found', 'Board not found.');
  await db.batch([
    {
      sql: 'DELETE FROM collection_items WHERE collection_id = ? AND item_type = ? AND item_id = ?',
      params: [board.id, type, itemId],
    },
    {
      sql: 'UPDATE collections SET updated_at = ? WHERE id = ?',
      params: [now.toISOString(), board.id],
    },
  ]);
}

export async function boardItems(
  db: Db,
  boardId: number,
  limit = MAX_ITEMS_PER_BOARD,
): Promise<BoardItem[]> {
  const rows = await db.all<{
    item_type: string;
    item_id: number;
    note: string | null;
    added_at: string;
  }>(
    `SELECT item_type, item_id, note, added_at FROM collection_items WHERE collection_id = ?
     ORDER BY position DESC LIMIT ?`,
    [boardId, limit],
  );
  return rows
    .filter((r) => isItemType(r.item_type))
    .map((r) => ({
      type: r.item_type as ItemType,
      id: r.item_id,
      note: r.note,
      addedAt: r.added_at,
    }));
}

const LABEL_SQL = `CASE i.item_type
         WHEN 'store' THEN (SELECT COALESCE(name, domain) FROM stores WHERE id = i.item_id)
         WHEN 'theme' THEN (SELECT name FROM themes WHERE id = i.item_id)
         WHEN 'app' THEN (SELECT name FROM apps WHERE id = i.item_id)
         WHEN 'section' THEN (SELECT COALESCE(st.name, st.domain) || ' · ' || s.section_type || ' · ' || s.page_type || ' · ' || s.device
                              FROM sections s JOIN stores st ON st.id = s.store_id WHERE s.id = i.item_id)
         WHEN 'screenshot' THEN (SELECT COALESCE(st.name, st.domain) || ' · ' || sh.page_type || ' · ' || sh.device
                              FROM screenshots sh JOIN stores st ON st.id = sh.store_id WHERE sh.id = i.item_id)
       END`;

/** A short human label for one item ("YoungLA · hero · home · desktop"), or null. */
export async function itemLabel(db: Db, type: ItemType, id: number): Promise<string | null> {
  const row = await db.first<{ label: string | null }>(
    `SELECT ${LABEL_SQL} AS label FROM (SELECT ? AS item_type, ? AS item_id) i`,
    [type, id],
  );
  return row?.label ?? null;
}

/** Rows for a CSV export of one board (Pro: "exports"). */
export async function boardCsv(db: Db, boardId: number): Promise<string> {
  const rows = await db.all<{
    item_type: string;
    label: string | null;
    url_path: string | null;
    added_at: string;
  }>(
    `SELECT i.item_type, i.added_at,
       ${LABEL_SQL} AS label,
       CASE i.item_type
         WHEN 'store' THEN (SELECT '/stores/' || domain FROM stores WHERE id = i.item_id)
         WHEN 'theme' THEN (SELECT '/themes/' || slug FROM themes WHERE id = i.item_id)
         WHEN 'app' THEN (SELECT '/apps/' || slug FROM apps WHERE id = i.item_id)
         WHEN 'section' THEN (SELECT '/sections/' || s.section_type || '/' || s.id FROM sections s WHERE s.id = i.item_id)
         WHEN 'screenshot' THEN (SELECT '/stores/' || st.domain FROM screenshots sh JOIN stores st ON st.id = sh.store_id WHERE sh.id = i.item_id)
       END AS url_path
     FROM collection_items i WHERE i.collection_id = ? ORDER BY i.position`,
    [boardId],
  );
  const cell = (v: string | null) => {
    const s = v ?? '';
    // Quote everything; neutralise spreadsheet formulas.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [['type', 'name', 'path', 'added_at'].map(cell).join(',')];
  for (const r of rows)
    lines.push([r.item_type, r.label, r.url_path, r.added_at].map(cell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
