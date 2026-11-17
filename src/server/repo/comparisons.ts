/** Popular comparison pairs (the comparisons table) as link objects. */
import type { Ctx } from '../api/v1/context.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { ComparisonLink } from '../api/v1/schemas/common.ts';
import type { SqlValue } from '../db/types.ts';
import { entityRef } from './refs.ts';

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
}

export function comparisonTitle(a: string, b: string): string {
  return `${a} vs ${b}`;
}

export async function comparisonLinks(
  ctx: Ctx,
  opts: { kind?: 'app' | 'theme' | undefined; entityId?: number; limit: number },
): Promise<ComparisonLink[]> {
  const kinds = opts.kind ? [opts.kind] : (['app', 'theme'] as const);
  const results = await Promise.all(
    kinds.map((kind) => {
      const table = kind === 'app' ? 'apps' : 'themes';
      const icon = (alias: string) => (kind === 'app' ? `${alias}.icon_url` : 'NULL');
      const short = (alias: string) => (kind === 'app' ? `${alias}.short_name` : `${alias}.name`);
      const where = ['c.kind = ?', "x.status = 'active'", "y.status = 'active'"];
      const params: SqlValue[] = [kind];
      if (opts.entityId !== undefined) {
        where.push('(c.a_id = ? OR c.b_id = ?)');
        params.push(opts.entityId, opts.entityId);
      }
      return ctx.db.all<LinkRow>(
        `SELECT c.slug, c.kind, c.reason,
           x.slug AS a_slug, x.name AS a_name, ${short('x')} AS a_short, ${icon('x')} AS a_icon,
           y.slug AS b_slug, y.name AS b_name, ${short('y')} AS b_short, ${icon('y')} AS b_icon
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
  }));
}
