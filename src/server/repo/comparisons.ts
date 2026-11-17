/** Popular comparison pairs (the comparisons table) as link objects. */
import type { Ctx } from '../api/v1/context.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { ComparisonLink } from '../api/v1/schemas/common.ts';
import type { SqlValue } from '../db/types.ts';
import { entityRef, jsonIds } from './refs.ts';

interface LinkRow {
  slug: string;
  kind: 'app' | 'theme';
  reason: string;
  a_slug: string;
  a_name: string;
  a_short: string;
  a_icon: string | null;
  b_slug: string;
  b_name: string;
  b_short: string;
  b_icon: string | null;
  shared: number | null;
}

/** Stores running both sides: co-installs for apps, detection history for themes. */
const SHARED_SQL = {
  app: `(SELECT ci.store_count FROM app_co_installs ci WHERE ci.app_id = c.a_id AND ci.other_app_id = c.b_id)`,
  theme: `(SELECT COUNT(DISTINCT x.store_id) FROM store_themes x
      JOIN store_themes y ON y.store_id = x.store_id AND y.theme_id = c.b_id
      JOIN stores s ON s.id = x.store_id AND s.status = 'active'
      WHERE x.theme_id = c.a_id)`,
} as const;

export function comparisonTitle(a: string, b: string): string {
  return `${a} vs ${b}`;
}

/**
 * Curated pairs in list order. `entityId`/`entityIds` keep the pairs that include one of those
 * apps or themes (one query for several, e.g. both sides of a comparison).
 */
export async function comparisonLinks(
  ctx: Ctx,
  opts: {
    kind?: 'app' | 'theme' | undefined;
    entityId?: number;
    entityIds?: readonly number[];
    limit: number;
  },
): Promise<ComparisonLink[]> {
  const entityIds = opts.entityIds ?? (opts.entityId !== undefined ? [opts.entityId] : undefined);
  const kinds = opts.kind ? [opts.kind] : (['app', 'theme'] as const);
  const results = await Promise.all(
    kinds.map((kind) => {
      const table = kind === 'app' ? 'apps' : 'themes';
      const icon = (alias: string) => (kind === 'app' ? `${alias}.icon_url` : 'NULL');
      const short = (alias: string) => (kind === 'app' ? `${alias}.short_name` : `${alias}.name`);
      const where = ['c.kind = ?', "x.status = 'active'", "y.status = 'active'"];
      const params: SqlValue[] = [kind];
      if (entityIds) {
        where.push(
          '(c.a_id IN (SELECT value FROM json_each(?)) OR c.b_id IN (SELECT value FROM json_each(?)))',
        );
        params.push(jsonIds(entityIds), jsonIds(entityIds));
      }
      return ctx.db.all<LinkRow>(
        `SELECT c.slug, c.kind, c.reason,
           x.slug AS a_slug, x.name AS a_name, ${short('x')} AS a_short, ${icon('x')} AS a_icon,
           y.slug AS b_slug, y.name AS b_name, ${short('y')} AS b_short, ${icon('y')} AS b_icon,
           ${SHARED_SQL[kind]} AS shared
         FROM comparisons c
         JOIN ${table} x ON x.id = c.a_id
         JOIN ${table} y ON y.id = c.b_id
         WHERE ${where.join(' AND ')}
         ORDER BY c.position LIMIT ?`,
        [...params, opts.limit],
      );
    }),
  );
  return results.flat().map((r) => ({
    slug: r.slug,
    href: hrefs.compare(r.slug),
    kind: r.kind,
    title: comparisonTitle(r.a_short, r.b_short),
    reason: r.reason,
    a: entityRef(r.kind, { slug: r.a_slug, name: r.a_name, icon_url: r.a_icon }),
    b: entityRef(r.kind, { slug: r.b_slug, name: r.b_name, icon_url: r.b_icon }),
    shared_stores: r.shared ?? 0,
  }));
}
