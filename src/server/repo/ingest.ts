/**
 * Capture ingest: turns one real capture (a full-page screenshot already stored in R2, plus the
 * sections detected on it) into `pages` / `screenshots` / `sections` rows.
 *
 * Used by the local pipeline today (scripts/capture/ingest-local.ts, against the local D1) and
 * written so a future admin ingest endpoint can call the same function on the remote D1.
 *
 * Rules:
 *  - Blocked or tombstoned domains are refused (contract step 3, docs/ARCHITECTURE.md): the
 *    caller must not keep the uploaded objects.
 *  - A placeholder screenshot for the same store × page type × device is replaced in place, so
 *    its id (referenced by teardown notes) stays stable; its drawn sections are deleted.
 *  - An earlier real capture is kept as history (`is_current = 0`, sections too).
 *  - Re-ingesting the same r2_key is a no-op, unless its sections changed (re-run detection,
 *    scripts/capture/reprocess.ts): then the sections are replaced in place (`resectioned`).
 *  - Teardown notes on that page × device are re-pointed at the new section of their type.
 *  - Derived tables are not rebuilt here: call rebuildDerived(db) once after a batch of ingests.
 *
 * New ids are allocated as MAX(id) + 1 before the batch, which assumes one ingest writer at a
 * time (the offline job). The batch itself is atomic.
 */
import { z } from 'zod';
import { DeviceEnum, PageTypeEnum, SectionTypeEnum } from '../api/v1/schemas/common.ts';
import type { Db, SqlValue, Statement } from '../db/types.ts';
import { normalizeDomain } from '../lib/slug.ts';
import { isServableKey } from '../media/serve.ts';
import { isCaptureBlocked } from './capture.ts';

const px = z.number().int().nonnegative();
const mediaKey = z
  .string()
  .max(512)
  .refine(isServableKey, 'not a servable media key')
  .refine((k) => k.endsWith('.webp'), 'media keys are .webp');

export const captureSectionSchema = z.object({
  type: SectionTypeEnum,
  y: px,
  height: px.positive(),
  x: px.default(0),
  w: px.positive().nullable().default(null),
  app_slug: z.string().max(120).nullable().default(null),
  r2_key_crop: mediaKey.nullable().default(null),
  theme_section_name: z.string().max(200).nullable().default(null),
  hints: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean()])).default({}),
});

export const captureInputSchema = z
  .object({
    domain: z.string().transform((d, ctx) => {
      const n = normalizeDomain(d);
      if (!n) ctx.addIssue({ code: 'custom', message: 'invalid domain' });
      return n ?? d;
    }),
    page_type: PageTypeEnum,
    device: DeviceEnum,
    url: z.url({ protocol: /^https?$/ }),
    viewport_w: px.positive(),
    width: px.positive(),
    height: px.positive(),
    bytes: px.nullable().default(null),
    r2_key: mediaKey,
    captured_at: z.iso.datetime(),
    sections: z.array(captureSectionSchema).max(200),
  })
  .superRefine((c, ctx) => {
    const prefix = `shots/${c.domain}/${c.page_type}/${c.device}/`;
    if (!c.r2_key.startsWith(prefix))
      ctx.addIssue({ code: 'custom', path: ['r2_key'], message: `must start with ${prefix}` });
    c.sections.forEach((s, i) => {
      if (s.y + s.height > c.height)
        ctx.addIssue({ code: 'custom', path: ['sections', i], message: 'outside the capture' });
    });
  });

export type CaptureInput = z.input<typeof captureInputSchema>;
export type CaptureRecord = z.output<typeof captureInputSchema>;

export type IngestResult =
  | { status: 'ingested'; screenshot_id: number; sections: number; replaced_placeholder: boolean }
  | { status: 'unchanged'; screenshot_id: number }
  | { status: 'resectioned'; screenshot_id: number; sections: number }
  | { status: 'blocked' }
  | { status: 'unknown-store' };

export async function ingestCapture(db: Db, input: CaptureInput): Promise<IngestResult> {
  const c = captureInputSchema.parse(input);
  if (await isCaptureBlocked(db, c.domain)) return { status: 'blocked' };

  const store = await db.first<{ id: number; current_theme_id: number | null }>(
    `SELECT id, current_theme_id FROM stores WHERE domain = ? AND status = 'active'`,
    [c.domain],
  );
  if (!store) return { status: 'unknown-store' };

  const current = await db.first<{ id: number; is_placeholder: number; r2_key: string | null }>(
    `SELECT id, is_placeholder, r2_key FROM screenshots
     WHERE store_id = ? AND page_type = ? AND device = ? AND is_current = 1
     ORDER BY is_placeholder, id DESC LIMIT 1`,
    [store.id, c.page_type, c.device],
  );
  const sameShot = !!current && current.is_placeholder === 0 && current.r2_key === c.r2_key;
  if (sameShot) {
    const existing = await db.all<{ k: string }>(
      `SELECT s.section_type || '|' || s.y || '|' || s.height || '|' || s.x || '|' ||
              COALESCE(s.w, '') || '|' || COALESCE(s.r2_key_crop, '') || '|' ||
              COALESCE(a.slug, '') AS k
       FROM sections s LEFT JOIN apps a ON a.id = s.app_id
       WHERE s.screenshot_id = ? ORDER BY s.order_index`,
      [current.id],
    );
    const incoming = [...c.sections]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((x) =>
        [x.type, x.y, x.height, x.x, x.w ?? '', x.r2_key_crop ?? '', x.app_slug ?? ''].join('|'),
      );
    if (existing.map((e) => e.k).join('\n') === incoming.join('\n'))
      return { status: 'unchanged', screenshot_id: current.id };
  }

  const appSlugs = [...new Set(c.sections.flatMap((s) => (s.app_slug ? [s.app_slug] : [])))];
  const appIds = new Map<string, number>();
  if (appSlugs.length) {
    const rows = await db.all<{ id: number; slug: string }>(
      `SELECT id, slug FROM apps WHERE slug IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(appSlugs)],
    );
    for (const r of rows) appIds.set(r.slug, r.id);
  }

  const page = await db.first<{ id: number }>(
    `SELECT id FROM pages WHERE store_id = ? AND page_type = ? ORDER BY is_placeholder, id LIMIT 1`,
    [store.id, c.page_type],
  );
  const max = await db.first<{ page: number; shot: number; section: number }>(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM pages) AS page,
            (SELECT COALESCE(MAX(id), 0) FROM screenshots) AS shot,
            (SELECT COALESCE(MAX(id), 0) FROM sections) AS section`,
  );
  const now = new Date().toISOString();
  const stmts: Statement[] = [];

  let pageId: number;
  if (page) {
    pageId = page.id;
    stmts.push({
      sql: 'UPDATE pages SET url = ?, is_placeholder = 0 WHERE id = ?',
      params: [c.url, pageId],
    });
  } else {
    pageId = (max?.page ?? 0) + 1;
    stmts.push({
      sql: `INSERT INTO pages (id, store_id, page_type, url, is_placeholder, created_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
      params: [pageId, store.id, c.page_type, c.url, now],
    });
  }

  const shotCols: SqlValue[] = [
    c.viewport_w,
    c.width,
    c.height,
    c.bytes,
    c.r2_key,
    c.captured_at,
    store.current_theme_id,
  ];
  const replacePlaceholder = current?.is_placeholder === 1;
  let shotId: number;
  if (current && sameShot) {
    shotId = current.id;
    stmts.push({ sql: 'DELETE FROM sections WHERE screenshot_id = ?', params: [shotId] });
  } else if (current && replacePlaceholder) {
    shotId = current.id;
    stmts.push(
      { sql: 'DELETE FROM sections WHERE screenshot_id = ?', params: [shotId] },
      {
        sql: `UPDATE screenshots SET page_id = ?, viewport_w = ?, width = ?, height = ?, bytes = ?,
                r2_key = ?, captured_at = ?, theme_id = ?, is_current = 1, is_placeholder = 0
              WHERE id = ?`,
        params: [pageId, ...shotCols, shotId],
      },
    );
  } else {
    shotId = (max?.shot ?? 0) + 1;
    if (current)
      stmts.push(
        { sql: 'UPDATE screenshots SET is_current = 0 WHERE id = ?', params: [current.id] },
        { sql: 'UPDATE sections SET is_current = 0 WHERE screenshot_id = ?', params: [current.id] },
      );
    stmts.push({
      sql: `INSERT INTO screenshots (id, page_id, store_id, page_type, device, viewport_w, width,
              height, bytes, r2_key, captured_at, theme_id, is_current, is_placeholder, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      params: [shotId, pageId, store.id, c.page_type, c.device, ...shotCols, now],
    });
  }

  const sorted = [...c.sections].sort((a, b) => a.y - b.y || a.x - b.x);
  sorted.forEach((s, order) => {
    stmts.push({
      sql: `INSERT INTO sections (id, screenshot_id, section_type, y, height, x, w, order_index,
              app_id, theme_section_name, r2_key_crop, is_placeholder, hints_json, store_id,
              page_type, device, theme_id, is_current)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1)`,
      params: [
        (max?.section ?? 0) + 1 + order,
        shotId,
        s.type,
        s.y,
        s.height,
        s.x,
        s.w,
        order,
        s.app_slug ? (appIds.get(s.app_slug) ?? null) : null,
        s.theme_section_name,
        s.r2_key_crop,
        Object.keys(s.hints).length ? JSON.stringify(s.hints) : null,
        store.id,
        c.page_type,
        c.device,
        store.current_theme_id,
      ],
    });
  });

  stmts.push({
    sql: `UPDATE teardown_notes SET screenshot_id = ?1,
            section_id = (SELECT s.id FROM sections s WHERE s.screenshot_id = ?1
                          AND s.section_type = teardown_notes.section_type
                          ORDER BY s.order_index LIMIT 1)
          WHERE page_type = ?2 AND device = ?3
            AND teardown_id IN (SELECT id FROM teardowns WHERE store_id = ?4)`,
    params: [shotId, c.page_type, c.device, store.id],
  });

  await db.batch(stmts);
  if (sameShot)
    return { status: 'resectioned', screenshot_id: shotId, sections: c.sections.length };
  return {
    status: 'ingested',
    screenshot_id: shotId,
    sections: sorted.length,
    replaced_placeholder: replacePlaceholder,
  };
}
