/**
 * Data loaders shared by the apps pages. They only compose the in-process API client (no SQL),
 * and keep the number of queries per request small (D1 allows 50 per request on the free plan;
 * `npm run budget:queries` checks the pages).
 */
import { api } from '~/server/api';
import type { AppListItem, SectionCard } from '~/server/api/v1/types';
import type { Device } from '~/lib/taxonomy';

/** Every tracked app by slug (usage, rating, icon), in at most two list calls of 100. */
export async function allApps(): Promise<Map<string, AppListItem>> {
  const out = new Map<string, AppListItem>();
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await api.listApps({ sort: 'usage', limit: 100, cursor });
    for (const a of r.data.items) out.set(a.slug, a);
    cursor = r.meta.pagination?.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

/**
 * One attributed section per app (on `device`), preferring the section type the app's category
 * usually renders. Only apps whose category renders a section are asked about, all of them in
 * one listSectionsByApps call (one query), six candidates each.
 */
export async function sectionPerApp(
  apps: readonly AppListItem[],
  device: Device,
  surfaceOf: (app: AppListItem) => string | null | undefined,
): Promise<Map<string, SectionCard>> {
  const out = new Map<string, SectionCard>();
  const asked = apps.filter((a) => surfaceOf(a));
  if (asked.length === 0) return out;
  const r = await api.listSectionsByApps({
    apps: asked.map((a) => a.slug),
    device,
    per_app: 6,
  });
  const sectionsOf = new Map(r.data.items.map((i) => [i.app_slug, i.sections]));
  for (const a of asked) {
    const items = sectionsOf.get(a.slug) ?? [];
    const surface = surfaceOf(a);
    const pick = items.find((s) => s.type.slug === surface) ?? items[0];
    if (pick) out.set(a.slug, pick);
  }
  return out;
}
