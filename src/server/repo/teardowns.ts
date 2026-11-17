/** Teardowns: editorial deep dives on one store, with numbered notes tied to sections. */
import type { Ctx } from '../api/v1/context.ts';
import { notFound } from '../api/v1/errors.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { ShotSection } from '../api/v1/schemas/common.ts';
import type { TeardownDetail, TeardownListItem } from '../api/v1/schemas/misc.ts';
import { getStoreDetail } from './stores.ts';
import { bool, pageTypeRef, sectionTypeRef, storeRef, themeRef } from './refs.ts';
import { homePreviews } from './visual.ts';

interface TeardownRow {
  id: number;
  slug: string;
  title: string;
  dek: string | null;
  body_md: string;
  published_at: string | null;
  is_sample: number;
  store_id: number;
  domain: string;
  name: string | null;
  is_curated: number;
  theme_slug: string | null;
  theme_name: string | null;
  theme_vendor: string | null;
  note_count: number;
}

const SELECT = `SELECT td.id, td.slug, td.title, td.dek, td.body_md, td.published_at, td.is_sample,
  s.id AS store_id, s.domain, s.name, s.is_curated,
  t.slug AS theme_slug, t.name AS theme_name, t.vendor AS theme_vendor,
  (SELECT COUNT(*) FROM teardown_notes n WHERE n.teardown_id = td.id) AS note_count
FROM teardowns td
JOIN stores s ON s.id = td.store_id AND s.status = 'active'
LEFT JOIN themes t ON t.id = s.current_theme_id`;

async function toItems(ctx: Ctx, rows: TeardownRow[]): Promise<TeardownListItem[]> {
  const covers = await homePreviews(
    ctx,
    rows.map((r) => r.store_id),
  );
  return rows.map((r) => ({
    slug: r.slug,
    href: hrefs.teardown(r.slug),
    title: r.title,
    dek: r.dek,
    published_at: r.published_at,
    is_sample: bool(r.is_sample),
    store: storeRef(r),
    theme:
      r.theme_slug && r.theme_name
        ? themeRef({ slug: r.theme_slug, name: r.theme_name, vendor: r.theme_vendor })
        : null,
    cover: covers.get(r.store_id) ?? null,
    note_count: r.note_count,
  }));
}

export async function listTeardowns(ctx: Ctx): Promise<TeardownListItem[]> {
  const rows = await ctx.db.all<TeardownRow>(
    `${SELECT} WHERE td.published_at IS NOT NULL ORDER BY td.published_at DESC, td.id DESC`,
  );
  return toItems(ctx, rows);
}

export async function getTeardown(ctx: Ctx, slug: string): Promise<TeardownDetail> {
  const row = await ctx.db.first<TeardownRow>(
    `${SELECT} WHERE td.slug = ? AND td.published_at IS NOT NULL`,
    [slug],
  );
  if (!row) throw notFound(`Teardown '${slug}'`);
  const [[item], store, notes] = await Promise.all([
    toItems(ctx, [row]),
    getStoreDetail(ctx, row.domain),
    ctx.db.all<{
      n: number;
      title: string;
      body: string;
      page_type: string;
      device: string;
      section_type: string;
      screenshot_id: number | null;
      section_id: number | null;
    }>(
      `SELECT n, title, body, page_type, device, section_type, screenshot_id, section_id
       FROM teardown_notes WHERE teardown_id = ? ORDER BY n`,
      [row.id],
    ),
  ]);
  if (!item) throw notFound(`Teardown '${slug}'`);
  // Notes resolve against the sections already loaded with the store detail.
  const sections = new Map<number, ShotSection>();
  for (const page of store.pages) {
    for (const shot of [page.screenshots.desktop, page.screenshots.mobile]) {
      for (const s of shot?.sections ?? []) sections.set(s.id, s);
    }
  }
  return {
    teardown: { ...item, body_md: row.body_md },
    store,
    notes: notes.map((n) => ({
      n: n.n,
      title: n.title,
      body: n.body,
      page_type: pageTypeRef(n.page_type).slug,
      device: n.device === 'mobile' ? 'mobile' : 'desktop',
      section_type: sectionTypeRef(n.section_type),
      screenshot_id: n.screenshot_id,
      section: n.section_id !== null ? (sections.get(n.section_id) ?? null) : null,
    })),
  };
}
