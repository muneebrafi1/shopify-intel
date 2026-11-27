/**
 * Instant search over the FTS5 `search_index`: prefix matching on every word, grouped by kind,
 * best title matches first, then popularity. An empty query returns popular suggestions.
 */
import type { Ctx } from '../api/v1/context.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { Image } from '../api/v1/schemas/common.ts';
import type { SearchHit, SearchKind, SearchOutput } from '../api/v1/schemas/misc.ts';
import type { SqlValue } from '../db/types.ts';
import { screenshotImage, sectionCropImage } from '../media/urls.ts';
import { ftsPrefixQuery } from './fts.ts';
import { jsonIds } from './refs.ts';
import { tidyStoreSubtitle } from '~/lib/format';

export const SEARCH_KINDS: ReadonlyArray<{ kind: SearchKind; label: string }> = [
  { kind: 'theme', label: 'Themes' },
  { kind: 'app', label: 'Apps' },
  { kind: 'store', label: 'Stores' },
  { kind: 'section-type', label: 'Sections' },
  { kind: 'app-category', label: 'App categories' },
  { kind: 'vendor', label: 'Theme vendors' },
  { kind: 'teardown', label: 'Teardowns' },
];

const HREF: Record<SearchKind, (ref: string) => string> = {
  store: hrefs.store,
  theme: hrefs.theme,
  app: hrefs.app,
  'app-category': hrefs.appCategory,
  'section-type': hrefs.sectionType,
  teardown: hrefs.teardown,
  vendor: hrefs.themeVendor,
};

interface IndexRow {
  kind: SearchKind;
  ref: string;
  title: string;
  subtitle: string | null;
}

/** Icons for apps, page thumbnails for stores/themes/teardowns, a crop for section types. */
async function visuals(ctx: Ctx, rows: IndexRow[]) {
  const refs = (kind: SearchKind) => rows.filter((r) => r.kind === kind).map((r) => r.ref);
  const icons = new Map<string, string | null>();
  const thumbs = new Map<string, Image>();
  const key = (kind: string, ref: string) => `${kind}:${ref}`;
  type Shot = {
    ref: string;
    id: number;
    r2_key: string | null;
    width: number;
    height: number;
    is_placeholder: number;
  };
  const shotSql = (refCol: string, join: string) =>
    `SELECT ${refCol} AS ref, sh.id, sh.r2_key, sh.width, sh.height, sh.is_placeholder
     FROM screenshots sh JOIN stores st ON st.id = sh.store_id AND st.status = 'active' ${join}
     WHERE ${refCol} IN (SELECT value FROM json_each(?)) AND sh.is_current = 1
       AND sh.page_type = 'home' AND sh.device = 'desktop'
     ORDER BY sh.is_placeholder, st.list_position`;

  const tasks: Array<Promise<void>> = [];
  const apps = refs('app');
  if (apps.length) {
    tasks.push(
      ctx.db
        .all<{ slug: string; icon_url: string | null }>(
          'SELECT slug, icon_url FROM apps WHERE slug IN (SELECT value FROM json_each(?))',
          [jsonIds(apps)],
        )
        .then((r) => r.forEach((a) => icons.set(key('app', a.slug), a.icon_url))),
    );
  }
  const addShots = (kind: SearchKind, sql: string, ids: string[]) => {
    if (!ids.length) return;
    tasks.push(
      ctx.db.all<Shot>(sql, [jsonIds(ids)]).then((r) =>
        r.forEach((s) => {
          if (!thumbs.has(key(kind, s.ref)))
            thumbs.set(key(kind, s.ref), screenshotImage(s, ctx.media));
        }),
      ),
    );
  };
  addShots('store', shotSql('st.domain', ''), refs('store'));
  addShots('theme', shotSql('t.slug', 'JOIN themes t ON t.id = sh.theme_id'), refs('theme'));
  addShots(
    'teardown',
    shotSql('td.slug', 'JOIN teardowns td ON td.store_id = st.id'),
    refs('teardown'),
  );
  const types = refs('section-type');
  if (types.length) {
    tasks.push(
      ctx.db
        .all<{
          section_type: string;
          id: number;
          r2_key_crop: string | null;
          height: number;
          w: number | null;
          is_placeholder: number;
          width: number;
        }>(
          `SELECT * FROM (
             SELECT s.section_type, s.id, s.r2_key_crop, s.height, s.w, s.is_placeholder, sh.width,
               ROW_NUMBER() OVER (PARTITION BY s.section_type ORDER BY s.is_placeholder, s.device, s.id) AS rn
             FROM sections s JOIN screenshots sh ON sh.id = s.screenshot_id
             JOIN stores st ON st.id = s.store_id AND st.status = 'active'
             WHERE s.is_current = 1 AND s.section_type IN (SELECT value FROM json_each(?))
           ) WHERE rn = 1`,
          [jsonIds(types)],
        )
        .then((r) =>
          r.forEach((s) =>
            thumbs.set(
              key('section-type', s.section_type),
              sectionCropImage(s, s.width, ctx.media),
            ),
          ),
        ),
    );
  }
  await Promise.all(tasks);
  return (r: IndexRow): Pick<SearchHit, 'icon_url' | 'thumbnail'> => ({
    icon_url: icons.get(key(r.kind, r.ref)) ?? null,
    thumbnail: thumbs.get(key(r.kind, r.ref)) ?? null,
  });
}

function lev(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

const words = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Typo-tolerant fallback for a query that matched nothing: one or two letters off a title word. */
async function fuzzyRows(ctx: Ctx, q: string, kinds: SearchKind[], limit: number) {
  const term = words(q).sort((a, b) => b.length - a.length)[0] ?? '';
  if (term.length < 4) return [];
  const pool = await ctx.db.all<IndexRow>(
    `SELECT kind, ref, title, subtitle FROM search_index
     WHERE kind IN (SELECT value FROM json_each(?)) AND search_index MATCH ?
     ORDER BY CAST(boost AS REAL) DESC LIMIT 600`,
    [JSON.stringify(kinds), `{title keywords} : "${term.slice(0, 3)}"*`],
  );
  const max = term.length <= 5 ? 1 : 2;
  const scored = pool
    .map((r) => {
      let d = 9;
      for (const w of words(r.title)) {
        d = Math.min(d, lev(term, w), lev(term, w.slice(0, term.length)));
      }
      return { r, d };
    })
    .filter((x) => x.d <= max)
    .sort((a, b) => a.d - b.d);
  const perKind = new Map<string, number>();
  return scored
    .filter(({ r }) => {
      const n = (perKind.get(r.kind) ?? 0) + 1;
      perKind.set(r.kind, n);
      return n <= limit;
    })
    .map((x) => x.r);
}

export async function search(
  ctx: Ctx,
  input: { q: string; kinds?: SearchKind[] | undefined; limit: number },
): Promise<SearchOutput> {
  const q = input.q.trim();
  const kinds = input.kinds?.length ? input.kinds : SEARCH_KINDS.map((k) => k.kind);
  const fts = q ? ftsPrefixQuery(q) : null;
  const isSuggestion = !q;
  if (q && !fts) return { q, is_suggestion: false, groups: [] };

  // Placeholders bind positionally: ORDER BY (inside the window) comes before WHERE.
  const params: SqlValue[] = [];
  let order = 'CAST(boost AS REAL) DESC, title';
  const where: string[] = ['kind IN (SELECT value FROM json_each(?))'];
  if (fts) {
    // Exact title, then title prefix, then any match; popularity breaks ties.
    order = `CASE WHEN lower(title) = lower(?) THEN 0 WHEN lower(title) LIKE lower(?) || '%' THEN 1 ELSE 2 END,
      CAST(boost AS REAL) DESC, title`;
    params.push(q, q.replace(/[%_]/g, ''));
    where.push('search_index MATCH ?');
    params.push(JSON.stringify(kinds), fts);
  } else {
    // Suggestions: popular themes, apps, curated stores and teardowns (unless kinds says otherwise).
    params.push(
      JSON.stringify(input.kinds?.length ? kinds : ['theme', 'app', 'store', 'teardown']),
    );
  }
  let rows = await ctx.db.all<IndexRow>(
    `SELECT kind, ref, title, subtitle FROM (
       SELECT kind, ref, title, subtitle, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY ${order}) AS rn
       FROM search_index WHERE ${where.join(' AND ')}
     ) WHERE rn <= ?`,
    [...params, input.limit],
  );
  if (fts && rows.length === 0) rows = await fuzzyRows(ctx, q, kinds, input.limit);
  const visual = await visuals(ctx, rows);
  const groups = SEARCH_KINDS.filter((k) => kinds.includes(k.kind)).flatMap((k) => {
    const items = rows
      .filter((r) => r.kind === k.kind)
      .map((r): SearchHit => ({
        kind: r.kind,
        ref: r.ref,
        title: r.title,
        subtitle: r.kind === 'store' ? tidyStoreSubtitle(r.subtitle) : r.subtitle,
        href: HREF[r.kind](r.ref),
        ...visual(r),
      }));
    return items.length ? [{ kind: k.kind, label: k.label, items }] : [];
  });
  return { q, is_suggestion: isSuggestion, groups };
}
