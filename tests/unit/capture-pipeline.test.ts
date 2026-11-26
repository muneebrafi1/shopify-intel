/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appBlockHandle,
  attributeApp,
  classifySection,
  cleanHandle,
  parseSection,
  type RawSection,
} from '../../scripts/capture/classify.ts';
import { cleanBoxes, cropKey, keyStamp, shotKey } from '../../scripts/capture/geometry.ts';
import { readManifest, upsertEntry, type ManifestEntry } from '../../scripts/capture/manifest.ts';
import { detectSections } from '../../scripts/capture/process.ts';
import { createApiClient } from '../../src/server/api/v1/client.ts';
import type { NodeDb } from '../../src/server/db/node-sqlite.ts';
import { captureBlockStatement } from '../../src/server/repo/capture.ts';
import { ingestCapture, type CaptureInput } from '../../src/server/repo/ingest.ts';
import { rebuildDerived } from '../../src/server/repo/maintenance.ts';
import { FIXED_NOW, seededDb, testDeps } from './helpers/db.ts';

const raw = (key: string, y: number, height: number, extra: Partial<RawSection> = {}) => ({
  id: key.startsWith('sections--')
    ? `shopify-section-${key}`
    : `shopify-section-template--18065845223529__${key}`,
  className: 'shopify-section',
  y,
  height,
  appBlocks: [],
  ...extra,
});

describe('section classification', () => {
  it('strips the random suffix Shopify adds to template keys', () => {
    expect(cleanHandle('sill_hero_Erij4X')).toBe('sill-hero');
    expect(cleanHandle('custom_liquid_mAQXmK')).toBe('custom-liquid');
    expect(cleanHandle('image_banner')).toBe('image-banner');
    expect(cleanHandle('featured_collection')).toBe('featured-collection');
    expect(cleanHandle('17131750905422b3cd')).toBe('17131750905422b3cd');
  });

  it('reads the section group and the theme type class', () => {
    const p = parseSection({
      id: 'shopify-section-sections--21178152714428__announcement-bar',
      className: 'shopify-section shopify-section-group-header-group shopify-section--announcement',
    });
    expect(p).toEqual({
      group: 'header',
      handle: 'announcement-bar',
      key: 'announcement-bar',
      typeClass: 'announcement',
    });
    expect(
      parseSection({ id: 'shopify-section-template--1__main', className: 'shopify-section' }).group,
    ).toBe('template');
  });

  const ctx = { templateIndex: 3, storeApps: ['instafeed', 'klaviyo'] };
  it.each([
    ['sill_featured_collections_m4fNxM', 'featured-collection'],
    ['sill_press_KyYDP7', 'logo-list'],
    ['sill_top_categories_FPLm7r', 'collection-list'],
    ['sill_blog_workshops_6WCMG8', 'blog-posts'],
    ['slideshow', 'slideshow'],
    ['image_with_text_aB12cD', 'image-with-text'],
    ['rich_text', 'rich-text'],
    ['faq', 'faq'],
    ['testimonials', 'testimonials'],
  ])('names %s as %s', (key, type) => {
    expect(classifySection(raw(key, 1000, 500), ctx)?.type).toBe(type);
  });

  it('drops sections it cannot name, except a tall first section (the hero)', () => {
    expect(classifySection(raw('sill_gifting_RhGanp', 1500, 600), ctx)).toBeNull();
    const first = classifySection(raw('sill_gifting_RhGanp', 112, 600), {
      ...ctx,
      templateIndex: 0,
    });
    expect(first).toMatchObject({ type: 'hero', by: 'position' });
  });

  it('keeps header and footer groups to chrome types', () => {
    const header = (key: string, height = 73) =>
      classifySection(
        raw(`sections--1__${key}`, 0, height, {
          className: 'shopify-section shopify-section-group-header-group',
        }),
        ctx,
      )?.type ?? null;
    expect(header('header_announcements_9jGBFp', 39)).toBe('announcement-bar');
    expect(header('header_section')).toBe('header');
    expect(header('custom_liquid_mAQXmK', 200)).toBeNull();

    const footer = (key: string) =>
      classifySection(
        raw(`sections--1__${key}`, 4000, 300, {
          className: 'shopify-section shopify-section-group-footer-group',
        }),
        ctx,
      )?.type ?? null;
    expect(footer('sill_footer_Yn9yjr')).toBe('footer');
    expect(footer('sill_reasons_to_buy_3PGyAK')).toBe('trust-badges');
    // Anything else in the footer group (marquees, copyright bars) is part of the footer.
    expect(footer('marquee_PynRVL')).toBe('footer');
    // Overlay groups (cart drawers, popups) are never sections of the page.
    expect(
      classifySection(
        raw('sections--1__cart-drawer', 0, 800, {
          className: 'shopify-section shopify-section-group-overlay-group',
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it('classifies app sections from their app blocks and attributes the app', () => {
    const block = 'shopify-block-AbWppU2tmdUVzK25NM__instafeed_app_block_Pm9WUp';
    expect(appBlockHandle(block)).toBe('instafeed');
    const hit = classifySection(
      raw('sill_social_feed_yCicQF', 4125, 605, { appBlocks: [block] }),
      ctx,
    );
    expect(hit).toMatchObject({ type: 'ugc-gallery', appSlug: 'instafeed', by: 'name' });

    const appsOnly = classifySection(
      raw('17131750905422b3cd', 4450, 612, {
        className: 'shopify-section shopify-section--apps',
        appBlocks: ['shopify-block-AcnFJZ2x1Q0UxdmZjc__covet_instagram_feed_reviews_app_block_x'],
      }),
      { ...ctx, storeApps: [] },
    );
    expect(appsOnly).toMatchObject({ type: 'ugc-gallery', appSlug: null, by: 'app-block' });
    // Numbered app blocks carry no name: nothing to attribute.
    expect(
      attributeApp(['shopify-block-AdEpnM0MycHo4NzBoN__2699851813924348007'], ['klaviyo']),
    ).toBeNull();
  });
});

describe('section geometry', () => {
  it('sorts, clips to the capture and drops tiny or nested boxes', () => {
    const boxes = cleanBoxes(
      [
        { type: 'footer', y: 5000, height: 900 },
        { type: 'header', y: 0.4, height: 72.6 },
        { type: 'rich-text', y: 80, height: 10 },
        { type: 'hero', y: 73, height: 600 },
        { type: 'slideshow', y: 80, height: 500 }, // nested in the hero
        { type: 'featured-collection', y: 650, height: 800 }, // overlaps the hero by 23 px
        { type: 'newsletter', y: 6000, height: 300 }, // below the cut
      ],
      5600,
    );
    expect(boxes).toEqual([
      { type: 'header', y: 0, height: 73 },
      { type: 'hero', y: 73, height: 577 },
      { type: 'featured-collection', y: 650, height: 800 },
      { type: 'footer', y: 5000, height: 600 },
    ]);
  });

  it('builds content-addressed media keys', () => {
    const at = '2026-11-25T18:15:02.123Z';
    expect(keyStamp(at)).toBe('20261125T181502Z');
    expect(shotKey('thesill.com', 'home', 'desktop', at)).toBe(
      'shots/thesill.com/home/desktop/20261125T181502Z.webp',
    );
    expect(cropKey('thesill.com', 'home', 'mobile', at, 2, 'hero')).toBe(
      'crops/thesill.com/home/mobile/20261125T181502Z/2-hero.webp',
    );
  });

  it('detects sections end to end from DOM boxes', () => {
    const { sections, unclassified } = detectSections(
      {
        height: 5539,
        sections: [
          raw('sections--1__header_section', 39, 73, {
            className: 'shopify-section shopify-section-group-header-group',
          }),
          raw('sill_hero_Erij4X', 112, 600),
          raw('sill_gifting_RhGanp', 712, 600),
          raw('hidden_collection_list', 0, 0),
          raw('sill_press_KyYDP7', 1312, 371),
        ],
      },
      [],
    );
    expect(sections.map((s) => [s.type, s.y, s.height])).toEqual([
      ['header', 39, 73],
      ['hero', 112, 600],
      ['logo-list', 1312, 371],
    ]);
    expect(unclassified).toEqual(['template--18065845223529__sill_gifting_RhGanp']);
  });
});

describe('capture manifest', () => {
  it('keeps one entry per store × page × device (latest wins)', () => {
    const entry = (at: string): ManifestEntry => ({
      capture: { ...capture(), captured_at: at },
      diagnostics: {
        full_height: 5539,
        truncated: false,
        device_scale_factor: 1,
        dom_sections: 12,
        unclassified: [],
      },
    });
    let m = readManifest('/nonexistent/manifest.json');
    m.failures.push({ domain: 'thesill.com', device: 'desktop', reason: 'http', at: 'x' });
    m = upsertEntry(m, entry('2026-11-25T10:00:00.000Z'));
    m = upsertEntry(m, entry('2026-11-25T11:00:00.000Z'));
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]?.capture.captured_at).toBe('2026-11-25T11:00:00.000Z');
    expect(m.failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------------------------
const AT = '2026-11-25T18:19:10.000Z';
function capture(over: Partial<CaptureInput> = {}): CaptureInput {
  const at = over.captured_at ?? AT;
  return {
    domain: 'thesill.com',
    page_type: 'home',
    device: 'desktop',
    url: 'https://www.thesill.com/',
    viewport_w: 1440,
    width: 1440,
    height: 5539,
    bytes: 382_000,
    r2_key: shotKey('thesill.com', 'home', 'desktop', at),
    captured_at: at,
    sections: [
      { type: 'header', y: 39, height: 73, theme_section_name: 'header_section' },
      {
        type: 'hero',
        y: 112,
        height: 600,
        r2_key_crop: cropKey('thesill.com', 'home', 'desktop', at, 1, 'hero'),
        hints: { source: 'dom', classified_by: 'name' },
      },
      { type: 'ugc-gallery', y: 4097, height: 605, app_slug: 'instafeed' },
      { type: 'footer', y: 4870, height: 669 },
    ],
    ...over,
  };
}

describe('ingestCapture', () => {
  let db: NodeDb;
  beforeEach(() => {
    db = seededDb();
  });
  afterEach(() => db.close());

  const current = () =>
    db.first<{ id: number; is_placeholder: number; r2_key: string; height: number }>(
      `SELECT sh.id, sh.is_placeholder, sh.r2_key, sh.height FROM screenshots sh
       JOIN stores s ON s.id = sh.store_id
       WHERE s.domain = 'thesill.com' AND sh.page_type = 'home' AND sh.device = 'desktop'
         AND sh.is_current = 1`,
    );

  it('replaces the placeholder in place and swaps its drawn sections for detected ones', async () => {
    const before = await current();
    expect(before?.is_placeholder).toBe(1);

    const res = await ingestCapture(db, capture());
    expect(res).toEqual({
      status: 'ingested',
      screenshot_id: before?.id,
      sections: 4,
      replaced_placeholder: true,
    });
    expect(await current()).toMatchObject({ id: before?.id, is_placeholder: 0, height: 5539 });

    const sections = await db.all<{
      section_type: string;
      is_placeholder: number;
      order_index: number;
      app: string | null;
      r2_key_crop: string | null;
    }>(
      `SELECT s.section_type, s.is_placeholder, s.order_index, a.slug AS app, s.r2_key_crop
       FROM sections s LEFT JOIN apps a ON a.id = s.app_id
       WHERE s.screenshot_id = ? ORDER BY s.order_index`,
      [before?.id ?? 0],
    );
    expect(sections.map((s) => s.section_type)).toEqual([
      'header',
      'hero',
      'ugc-gallery',
      'footer',
    ]);
    expect(sections.every((s) => s.is_placeholder === 0)).toBe(true);
    expect(sections[2]?.app).toBe('instafeed');
    expect(sections[1]?.r2_key_crop).toMatch(/^crops\/thesill\.com\/home\/desktop\//);

    const page = await db.first<{ url: string; is_placeholder: number }>(
      `SELECT p.url, p.is_placeholder FROM pages p JOIN screenshots sh ON sh.page_id = p.id
       WHERE sh.id = ?`,
      [before?.id ?? 0],
    );
    expect(page).toEqual({ url: 'https://www.thesill.com/', is_placeholder: 0 });
  });

  it('serves the real capture through the API once derived tables are rebuilt', async () => {
    await ingestCapture(db, capture());
    await rebuildDerived(db);
    const api = createApiClient(testDeps(db));
    const { data } = await api.getStore({ domain: 'thesill.com' });
    const home = data.pages.find((p) => p.page_type.slug === 'home');
    expect(home?.is_placeholder).toBe(false);
    expect(home?.screenshots.desktop?.image).toMatchObject({
      src: `/media/${capture().r2_key}`,
      is_placeholder: false,
      width: 1440,
      height: 5539,
    });
    // Mobile is still a planned layout until it is captured too.
    expect(home?.screenshots.mobile?.image.is_placeholder).toBe(true);
    const flag = await db.first<{ is_captured: number }>(
      "SELECT is_captured FROM stores WHERE domain = 'thesill.com'",
    );
    expect(flag?.is_captured).toBe(1);
  });

  it('re-points teardown notes at the detected section of their type', async () => {
    const { screenshot_id } = (await ingestCapture(db, capture())) as { screenshot_id: number };
    const notes = await db.all<{
      section_type: string;
      screenshot_id: number;
      section: string | null;
    }>(
      `SELECT n.section_type, n.screenshot_id, s.section_type AS section FROM teardown_notes n
       JOIN teardowns t ON t.id = n.teardown_id JOIN stores st ON st.id = t.store_id
       LEFT JOIN sections s ON s.id = n.section_id
       WHERE st.domain = 'thesill.com' AND n.page_type = 'home' AND n.device = 'desktop'`,
    );
    for (const n of notes) {
      expect(n.screenshot_id).toBe(screenshot_id);
      // Either the matching detected section, or none when the type was not detected.
      expect([n.section_type, null]).toContain(n.section);
    }
  });

  it('is idempotent and keeps earlier real captures as history', async () => {
    const first = await ingestCapture(db, capture());
    expect(await ingestCapture(db, capture())).toEqual({
      status: 'unchanged',
      screenshot_id: (first as { screenshot_id: number }).screenshot_id,
    });

    const later = '2026-12-01T09:00:00.000Z';
    const second = await ingestCapture(
      db,
      capture({
        captured_at: later,
        r2_key: shotKey('thesill.com', 'home', 'desktop', later),
        sections: [],
      }),
    );
    expect(second).toMatchObject({ status: 'ingested', replaced_placeholder: false });
    const rows = await db.all<{ is_current: number; n: number }>(
      `SELECT sh.is_current, (SELECT COUNT(*) FROM sections s WHERE s.screenshot_id = sh.id AND s.is_current = 1) AS n
       FROM screenshots sh JOIN stores st ON st.id = sh.store_id
       WHERE st.domain = 'thesill.com' AND sh.page_type = 'home' AND sh.device = 'desktop'
       ORDER BY sh.id`,
    );
    expect(rows).toEqual([
      { is_current: 0, n: 0 },
      { is_current: 1, n: 0 },
    ]);
  });

  it('replaces the sections in place when the same capture is re-detected', async () => {
    const first = (await ingestCapture(db, capture())) as { screenshot_id: number };
    const base = capture();
    const res = await ingestCapture(db, {
      ...base,
      sections: [...base.sections, { type: 'footer', y: 5000, height: 400 }],
    });
    expect(res).toEqual({
      status: 'resectioned',
      screenshot_id: first.screenshot_id,
      sections: base.sections.length + 1,
    });
    const n = await db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sections WHERE screenshot_id = ?',
      [first.screenshot_id],
    );
    expect(n?.n).toBe(base.sections.length + 1);
  });

  it('refuses blocked domains and unknown stores', async () => {
    const block = captureBlockStatement({ domain: 'thesill.com', scope: 'screenshots' }, FIXED_NOW);
    await db.run(block.sql, block.params);
    expect(await ingestCapture(db, capture())).toEqual({ status: 'blocked' });
    expect((await current())?.is_placeholder).toBe(1);

    const at = AT;
    expect(
      await ingestCapture(
        db,
        capture({
          domain: 'not-a-store.example',
          r2_key: shotKey('not-a-store.example', 'home', 'desktop', at),
        }),
      ),
    ).toEqual({ status: 'unknown-store' });
  });

  it('rejects keys outside the capture layout and sections outside the image', async () => {
    await expect(
      ingestCapture(db, capture({ r2_key: 'shots/youngla.com/home/desktop/x.webp' })),
    ).rejects.toThrow(/must start with/);
    await expect(
      ingestCapture(db, capture({ r2_key: 'shots/thesill.com/home/desktop/../x.webp' })),
    ).rejects.toThrow();
    await expect(
      ingestCapture(db, capture({ sections: [{ type: 'footer', y: 5500, height: 100 }] })),
    ).rejects.toThrow(/outside the capture/);
    await expect(
      ingestCapture(
        db,
        capture({ sections: [{ type: 'not-a-type' as 'footer', y: 0, height: 10 }] }),
      ),
    ).rejects.toThrow();
  });
});
