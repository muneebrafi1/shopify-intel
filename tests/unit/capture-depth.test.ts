import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { RawSection } from '../../scripts/capture/classify.ts';
import { classifySection } from '../../scripts/capture/classify.ts';
import { readManifest, upsertEntry, type ManifestEntry } from '../../scripts/capture/manifest.ts';
import { detectSections, topThumb } from '../../scripts/capture/process.ts';
import { captureDevice, thumbUrl, topThumbKey } from '../../src/lib/media.ts';

const raw = (key: string, y: number, height: number, extra: Partial<RawSection> = {}) => ({
  id: `shopify-section-template--1__${key}`,
  className: 'shopify-section',
  y,
  height,
  appBlocks: [],
  ...extra,
});

const ctx = (pageType: 'home' | 'collection' | 'product' | 'cart', templateIndex = 0) => ({
  templateIndex,
  storeApps: [],
  pageType,
});

describe('page-type section rules', () => {
  it('classifies collection, product and cart sections by page', () => {
    expect(classifySection(raw('main-collection-banner', 0, 200), ctx('collection'))?.type).toBe(
      'collection-header',
    );
    expect(
      classifySection(raw('main-collection-product-grid', 200, 900), ctx('collection'))?.type,
    ).toBe('product-grid');
    expect(classifySection(raw('main-product', 0, 900), ctx('product'))?.type).toBe('buy-box');
    expect(classifySection(raw('main', 0, 900), ctx('product'))?.type).toBe('buy-box');
    expect(classifySection(raw('main-cart-items', 0, 600), ctx('cart'))?.type).toBe('cart-items');
    expect(classifySection(raw('main-cart-footer', 600, 300), ctx('cart'))?.type).toBe(
      'cart-summary',
    );
  });

  it('only guesses a hero from position on the home page', () => {
    expect(classifySection(raw('xyz_block', 100, 600), ctx('home'))?.type).toBe('hero');
    expect(classifySection(raw('xyz_block', 100, 600), ctx('collection'))).toBeNull();
  });
});

describe('product gallery / buy box split', () => {
  const product = (split: RawSection['split']) =>
    detectSections(
      { height: 3000, width: 1440, sections: [raw('main-product', 100, 900, { split })] },
      [],
      'product',
    ).sections;

  it('splits side by side on desktop, keeping the full row height', () => {
    const s = product({
      gallery: { x: 40, y: 120, w: 820, h: 860 },
      buy: { x: 900, y: 120, w: 500, h: 700 },
    });
    expect(s.map((x) => [x.type, x.x, x.w, x.y, x.height, x.column])).toEqual([
      ['product-gallery', 0, 900, 100, 900, 'left'],
      ['buy-box', 900, 540, 100, 900, 'right'],
    ]);
  });

  it('stacks on mobile: gallery above, buy box below', () => {
    const s = detectSections(
      {
        height: 4000,
        width: 390,
        sections: [
          raw('main-product', 100, 1500, {
            split: {
              gallery: { x: 0, y: 100, w: 390, h: 500 },
              buy: { x: 0, y: 600, w: 390, h: 900 },
            },
          }),
        ],
      },
      [],
      'product',
    ).sections;
    expect(s.map((x) => [x.type, x.y, x.height])).toEqual([
      ['product-gallery', 100, 500],
      ['buy-box', 600, 1000],
    ]);
  });

  it('keeps one buy box when no gallery was found', () => {
    const s = product({ gallery: null, buy: { x: 900, y: 120, w: 500, h: 700 } });
    expect(s.map((x) => x.type)).toEqual(['buy-box']);
  });
});

describe('pre-cut top thumbnails', () => {
  const shot = '/media/shots/thesill.com/home/desktop/20261125T181502Z.webp';
  const mobile = '/media/shots/thesill.com/cart/mobile/20261125T181502Z.webp';

  it('recognises capture URLs and their device', () => {
    expect(captureDevice(shot)).toBe('desktop');
    expect(captureDevice(`${mobile}?v=1`)).toBe('mobile');
    expect(captureDevice('/media/crops/thesill.com/home/mobile/x/2-hero.webp')).toBeNull();
    expect(topThumbKey('shots/a/home/desktop/x.webp')).toBe('shots/a/home/desktop/x.top.webp');
  });

  it('serves the top thumb when the crop fits inside it, the full page otherwise', () => {
    expect(thumbUrl(shot, { cropHeight: 1296 })).toBe(shot.replace('.webp', '.top.webp'));
    expect(thumbUrl(shot, { cropHeight: 2000 })).toBe(shot);
    expect(thumbUrl(mobile, { cropHeight: 1014 })).toBe(mobile.replace('.webp', '.top.webp'));
    expect(thumbUrl('/media/crops/a/home/desktop/x/1-hero.webp', { cropHeight: 300 })).toBe(
      '/media/crops/a/home/desktop/x/1-hero.webp',
    );
    expect(thumbUrl('/media/placeholder/a/home/desktop.svg', { cropHeight: 300 })).toBe(
      '/media/placeholder/a/home/desktop.svg?h=300',
    );
  });

  it('cuts the top of the page at the thumbnail width', async () => {
    const full = await sharp({
      create: { width: 780, height: 6000, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const meta = await sharp(await topThumb(full, 'mobile', 390)).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(Math.round((390 * 2.9 * 2 * 600) / 780));
  });
});

describe('manifest failures per page', () => {
  it('clears only the failure for the same store × page × device', () => {
    const m = readManifest('/nonexistent/manifest.json');
    m.failures.push(
      { domain: 'a.com', page_type: 'cart', device: 'mobile', reason: 'timeout', at: 'x' },
      { domain: 'a.com', page_type: 'product', device: 'mobile', reason: 'http', at: 'x' },
    );
    const entry = {
      capture: { domain: 'a.com', page_type: 'cart', device: 'mobile' },
    } as unknown as ManifestEntry;
    expect(upsertEntry(m, entry).failures.map((f) => f.page_type)).toEqual(['product']);
  });
});
