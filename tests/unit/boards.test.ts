/** Boards repository: CRUD scoped to the owner, item resolution, limits and CSV export. */
import { describe, expect, it } from 'vitest';
import {
  addItem,
  boardCsv,
  boardItems,
  BoardError,
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  removeItem,
  resolveItem,
  updateBoard,
} from '../../src/server/account/boards.ts';
import { upsertWhopUser } from '../../src/server/account/users.ts';
import { FIXED_NOW, seededDb } from './helpers/db.ts';

const P = { pro: null, team: null };

async function setup() {
  const db = seededDb();
  const a = await upsertWhopUser(
    db,
    { whopUserId: 'user_A', email: 'a@example.com', name: 'A' },
    P,
    FIXED_NOW,
  );
  const b = await upsertWhopUser(
    db,
    { whopUserId: 'user_B', email: 'b@example.com', name: 'B' },
    P,
    FIXED_NOW,
  );
  const store = await db.first<{ domain: string }>(
    "SELECT domain FROM stores WHERE status = 'active' ORDER BY id LIMIT 1",
  );
  const section = await db.first<{ id: number }>(
    "SELECT s.id FROM sections s JOIN stores st ON st.id = s.store_id AND st.status = 'active' ORDER BY s.id LIMIT 1",
  );
  const theme = await db.first<{ slug: string }>(
    "SELECT slug FROM themes WHERE status = 'active' LIMIT 1",
  );
  return { db, a, b, store: store!.domain, section: section!.id, theme: theme!.slug };
}

describe('boards', () => {
  it('creates boards with unique slugs and reserves example-', async () => {
    const { db, a } = await setup();
    expect((await createBoard(db, a, { name: 'Hero ideas' }, FIXED_NOW)).slug).toBe('hero-ideas');
    expect((await createBoard(db, a, { name: 'Hero  ideas ' }, FIXED_NOW)).slug).toBe(
      'hero-ideas-2',
    );
    expect((await createBoard(db, a, { name: 'Example reviews' }, FIXED_NOW)).slug).toBe(
      'my-example-reviews',
    );
    expect((await createBoard(db, a, { name: '✨✨' }, FIXED_NOW)).slug).toBe('board');
    await expect(createBoard(db, a, { name: '   ' })).rejects.toBeInstanceOf(BoardError);
    expect((await listBoards(db, a)).length).toBe(4);
  });

  it('adds, dedupes, lists and removes items', async () => {
    const { db, a, store, section, theme } = await setup();
    await createBoard(db, a, { name: 'Pitch' }, FIXED_NOW);
    expect(await addItem(db, a, 'pitch', 'section', String(section), FIXED_NOW)).toBe(true);
    expect(await addItem(db, a, 'pitch', 'section', String(section), FIXED_NOW)).toBe(false);
    expect(await addItem(db, a, 'pitch', 'store', store.toUpperCase(), FIXED_NOW)).toBe(true);
    expect(await addItem(db, a, 'pitch', 'theme', theme, FIXED_NOW)).toBe(true);
    const board = await getBoard(db, a, 'pitch');
    expect(board).toMatchObject({ count: 3, thumbSectionIds: [section] });
    const items = await boardItems(db, board!.id);
    expect(items.map((i) => i.type)).toEqual(['theme', 'store', 'section']);
    await removeItem(db, a, 'pitch', 'section', section, FIXED_NOW);
    expect((await getBoard(db, a, 'pitch'))?.count).toBe(2);
  });

  it('refuses unknown items', async () => {
    const { db, a } = await setup();
    await createBoard(db, a, { name: 'X' });
    await expect(addItem(db, a, 'x', 'store', 'no-such-store.example')).rejects.toMatchObject({
      code: 'unknown_item',
    });
    await expect(addItem(db, a, 'x', 'section', '1 OR 1=1')).rejects.toMatchObject({
      code: 'unknown_item',
    });
    expect(await resolveItem(db, 'section', '999999999')).toBeNull();
  });

  it("never touches another user's board", async () => {
    const { db, a, b, store } = await setup();
    await createBoard(db, a, { name: 'Mine' });
    expect(await getBoard(db, b, 'mine')).toBeNull();
    await expect(addItem(db, b, 'mine', 'store', store)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(updateBoard(db, b, 'mine', { name: 'Theirs' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(deleteBoard(db, b, 'mine')).rejects.toMatchObject({ code: 'not_found' });
    expect((await getBoard(db, a, 'mine'))?.name).toBe('Mine');
  });

  it('renames, deletes and exports CSV with formula-safe cells', async () => {
    const { db, a, store, section } = await setup();
    await createBoard(db, a, { name: 'Brief' });
    await updateBoard(db, a, 'brief', { name: '=HYPERLINK("x")', description: 'For the client' });
    await addItem(db, a, 'brief', 'store', store);
    await addItem(db, a, 'brief', 'section', String(section));
    const board = await getBoard(db, a, 'brief');
    expect(board?.name).toBe('=HYPERLINK("x")');
    const csv = await boardCsv(db, board!.id);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('"type","name","path","added_at"');
    expect(lines[1]).toContain(`"/stores/${store}"`);
    expect(lines[2]).toMatch(/^"section",".+","\/sections\/[\w-]+\/\d+"/);
    await deleteBoard(db, a, 'brief');
    expect(await getBoard(db, a, 'brief')).toBeNull();
    expect(await db.first('SELECT COUNT(*) AS n FROM collection_items')).toEqual({ n: 0 });
  });
});
