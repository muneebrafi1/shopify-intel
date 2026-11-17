/**
 * Placeholder capture plan: a plausible, deterministic section layout for every core page type
 * on desktop and mobile, so the visual library can be designed before real captures exist.
 *
 * Determinism: store-wide choices (header style, gallery style…) come from rng(domain), the page
 * structure from rng(domain|page) — so desktop and mobile show the same sections, as one theme
 * serves both — and pixel sizes from rng(domain|page|device).
 *
 * Geometry model (also documented in docs/API.md):
 *  - Every section is a rectangle on the full-page screenshot: x, y, w (null = full width), height.
 *  - Desktop has two-column rows: product-gallery | buy-box on product pages, sidebar filters |
 *    product-grid on collections (when the store uses a sidebar), cart-items | cart-summary on
 *    split carts. Both sections share y and height and carry hints.column = 'left' | 'right'.
 *  - On mobile those rows stack (sidebar filters become a toolbar that opens a drawer).
 *  - Screenshot height = max(y + height).
 *
 * App attribution: a section is attributed to an app only when the store has that app and the
 * app's category lists the section type as its primary surface (APP_CATEGORY_SURFACES[cat][0]);
 * with several candidates the most-used app (global store count) wins. Headers are attributed
 * (currency/translation selectors) on home pages only, so one widget is not counted per page.
 */
import { createRng, type Rng } from '../../src/server/lib/rng.ts';
import {
  APP_CATEGORY_SURFACES,
  CORE_PAGE_TYPES,
  DEVICES,
  type Device,
  type PageType,
  type SectionType,
} from '../../src/lib/taxonomy.ts';

export type Hints = Record<string, string | number | boolean>;

export interface LayoutApp {
  slug: string;
  category: string;
  /** Global usage, used to pick the primary app when several qualify. */
  storeCount: number;
}

export interface LayoutSection {
  type: SectionType;
  y: number;
  height: number;
  x: number;
  w: number | null;
  appSlug: string | null;
  hints: Hints;
}

export interface LayoutShot {
  pageType: PageType;
  device: Device;
  viewport: number;
  width: number;
  height: number;
  sections: LayoutSection[];
}

/** A block in the device-independent page structure. */
interface Block {
  type: SectionType;
  hints: Hints;
}
type Row = { kind: 'single'; block: Block } | { kind: 'columns'; left: Block; right: Block };

interface StoreStyle {
  announcement: boolean;
  headerLayout: 'logo-left' | 'logo-center';
  megaMenu: boolean;
  breadcrumbs: boolean;
  cardRatio: number;
  galleryLayout: 'thumbnails-left' | 'thumbnails-below' | 'grid';
  detailsLayout: 'accordion' | 'tabs' | 'inline';
  filtersLayout: 'sidebar' | 'toolbar';
  cartLayout: 'split' | 'stacked';
  footerColumns: number;
}

const DESKTOP_GUTTER = 48;

function storeStyle(domain: string): StoreStyle {
  const rng = createRng(`${domain}|style`);
  return {
    announcement: rng.chance(0.75),
    headerLayout: rng.weighted([
      ['logo-left', 0.6],
      ['logo-center', 0.4],
    ] as const),
    megaMenu: rng.chance(0.4),
    breadcrumbs: rng.chance(0.4),
    cardRatio: rng.pick([1, 1.25, 1.25, 1.33]),
    galleryLayout: rng.pick(['thumbnails-left', 'thumbnails-below', 'grid'] as const),
    detailsLayout: rng.pick(['accordion', 'accordion', 'tabs', 'inline'] as const),
    filtersLayout: rng.weighted([
      ['sidebar', 0.45],
      ['toolbar', 0.55],
    ] as const),
    cartLayout: rng.weighted([
      ['split', 0.6],
      ['stacked', 0.4],
    ] as const),
    footerColumns: rng.int(3, 5),
  };
}

/** Picks the most-used store app whose category's primary surface is `type`. */
export function attributionFor(type: SectionType, apps: readonly LayoutApp[]): string | null {
  const candidates = apps.filter((a) => APP_CATEGORY_SURFACES[a.category]?.[0] === type);
  candidates.sort((a, b) => b.storeCount - a.storeCount || a.slug.localeCompare(b.slug));
  return candidates[0]?.slug ?? null;
}

const single = (type: SectionType, hints: Hints = {}): Row => ({
  kind: 'single',
  block: { type, hints },
});

function chrome(style: StoreStyle): { top: Row[]; bottom: Row[] } {
  const top: Row[] = [];
  if (style.announcement) top.push(single('announcement-bar', { messages: 1 }));
  top.push(single('header', { layout: style.headerLayout, mega_menu: style.megaMenu }));
  return { top, bottom: [single('footer', { columns: style.footerColumns })] };
}

function homeRows(domain: string, style: StoreStyle, apps: readonly LayoutApp[]): Row[] {
  const rng = createRng(`${domain}|home`);
  const { top, bottom } = chrome(style);
  const rows: Row[] = [...top];

  if (rng.chance(0.7)) {
    rows.push(
      single('hero', {
        style: rng.weighted([
          ['image', 0.5],
          ['split', 0.25],
          ['video', 0.25],
        ] as const),
        text_align: rng.pick(['left', 'center'] as const),
      }),
    );
  } else {
    rows.push(single('slideshow', { slides: rng.int(2, 4) }));
  }
  rows.push(single('featured-collection', { products: rng.pick([4, 8]) }));

  const middle: Row[] = [];
  const hasBuilder = attributionFor('image-with-text', apps) !== null;
  if (rng.chance(0.6)) middle.push(single('collection-list', { tiles: rng.pick([3, 4, 6]) }));
  if (hasBuilder || rng.chance(0.65)) {
    middle.push(
      single('image-with-text', { image_position: rng.pick(['left', 'right'] as const) }),
    );
  }
  if (rng.chance(0.4)) middle.push(single('rich-text', { text_align: 'center' }));
  if (rng.chance(0.3)) middle.push(single('logo-list', { logos: rng.int(4, 6) }));
  if (rng.chance(0.35)) middle.push(single('testimonials', { count: rng.int(3, 4) }));
  if (rng.chance(0.2)) middle.push(single('video', { autoplay: rng.chance(0.5) }));
  if (rng.chance(0.45)) middle.push(single('featured-collection', { products: 4 }));
  if (attributionFor('loyalty', apps)) middle.push(single('loyalty', { style: 'banner' }));
  // Real home pages rarely have fewer than three content sections between hero and footer.
  for (const type of ['collection-list', 'image-with-text', 'testimonials', 'rich-text'] as const) {
    if (middle.length >= 3) break;
    if (!middle.some((r) => r.kind === 'single' && r.block.type === type)) {
      middle.push(single(type, type === 'collection-list' ? { tiles: 3 } : {}));
    }
  }
  rows.push(...rng.shuffle(middle).slice(0, 6));

  if (attributionFor('reviews', apps) && rng.chance(0.35)) {
    rows.push(single('reviews', { layout: 'carousel', photos: rng.chance(0.5) }));
  }
  if (attributionFor('ugc-gallery', apps)) {
    rows.push(single('ugc-gallery', { layout: rng.pick(['grid', 'carousel'] as const) }));
  }
  if (rng.chance(0.25)) rows.push(single('blog-posts', { posts: 3 }));
  rows.push(single('newsletter', { layout: rng.pick(['inline', 'split'] as const) }));
  return [...rows, ...bottom];
}

function collectionRows(domain: string, style: StoreStyle): Row[] {
  const rng = createRng(`${domain}|collection`);
  const { top, bottom } = chrome(style);
  const rows: Row[] = [...top];
  if (style.breadcrumbs) rows.push(single('breadcrumbs'));
  rows.push(single('collection-header', { banner: rng.chance(0.5) }));
  const grid: Block = {
    type: 'product-grid',
    hints: { products: rng.pick([24, 24, 32, 48]) },
  };
  if (style.filtersLayout === 'sidebar') {
    rows.push({
      kind: 'columns',
      left: { type: 'filters', hints: { layout: 'sidebar' } },
      right: grid,
    });
  } else {
    rows.push(single('filters', { layout: 'toolbar' }), { kind: 'single', block: grid });
  }
  if (rng.chance(0.25)) rows.push(single('newsletter', { layout: 'inline' }));
  return [...rows, ...bottom];
}

function productRows(domain: string, style: StoreStyle, apps: readonly LayoutApp[]): Row[] {
  const rng = createRng(`${domain}|product`);
  const { top, bottom } = chrome(style);
  const rows: Row[] = [...top];
  if (style.breadcrumbs) rows.push(single('breadcrumbs'));
  rows.push({
    kind: 'columns',
    left: {
      type: 'product-gallery',
      hints: { layout: style.galleryLayout, images: rng.int(4, 8) },
    },
    right: {
      type: 'buy-box',
      hints: {
        sticky: rng.chance(0.5),
        variants: rng.pick(['buttons', 'dropdown', 'swatches'] as const),
      },
    },
  });
  rows.push(single('product-details', { layout: style.detailsLayout }));
  if (rng.chance(0.3)) rows.push(single('trust-badges', { badges: rng.int(3, 4) }));
  if (rng.chance(0.3)) {
    rows.push(single('image-with-text', { image_position: rng.pick(['left', 'right'] as const) }));
  }
  if (rng.chance(0.2)) rows.push(single('faq', { questions: rng.int(4, 6) }));
  if (attributionFor('reviews', apps)) {
    rows.push(
      single('reviews', { layout: rng.pick(['list', 'grid'] as const), photos: rng.chance(0.6) }),
    );
  }
  if (attributionFor('ugc-gallery', apps) && rng.chance(0.5)) {
    rows.push(single('ugc-gallery', { layout: 'carousel' }));
  }
  if (attributionFor('upsell', apps) || rng.chance(0.7)) {
    rows.push(single('upsell', { products: 4, layout: rng.pick(['grid', 'carousel'] as const) }));
  }
  if (rng.chance(0.35)) rows.push(single('recently-viewed', { products: 4 }));
  return [...rows, ...bottom];
}

function cartRows(domain: string, style: StoreStyle, apps: readonly LayoutApp[]): Row[] {
  const rng = createRng(`${domain}|cart`);
  const { top, bottom } = chrome(style);
  const rows: Row[] = [...top];
  if (attributionFor('shipping-bar', apps) || rng.chance(0.25)) {
    rows.push(single('shipping-bar', { progress: rng.int(35, 85) }));
  }
  const items: Block = { type: 'cart-items', hints: { items: rng.int(2, 3) } };
  const summary: Block = { type: 'cart-summary', hints: { notes: rng.chance(0.4) } };
  if (style.cartLayout === 'split') rows.push({ kind: 'columns', left: items, right: summary });
  else rows.push({ kind: 'single', block: items }, { kind: 'single', block: summary });
  if (rng.chance(0.3)) rows.push(single('trust-badges', { badges: 3 }));
  if (attributionFor('upsell', apps) || rng.chance(0.55)) {
    rows.push(single('upsell', { products: 4, layout: 'carousel' }));
  }
  if (rng.chance(0.35)) rows.push(single('recently-viewed', { products: 4 }));
  return [...rows, ...bottom];
}

// ---------------------------------------------------------------------------------------------
// Sizing (CSS px). Mobile sections are taller relative to their width: content stacks.
// ---------------------------------------------------------------------------------------------

type Range = readonly [number, number];
const SIMPLE: Partial<Record<SectionType, { desktop: Range; mobile: Range }>> = {
  'announcement-bar': { desktop: [36, 44], mobile: [36, 52] },
  breadcrumbs: { desktop: [40, 52], mobile: [36, 48] },
  slideshow: { desktop: [580, 780], mobile: [520, 680] },
  'image-with-text': { desktop: [520, 700], mobile: [720, 940] },
  video: { desktop: [560, 760], mobile: [320, 420] },
  'rich-text': { desktop: [220, 360], mobile: [260, 440] },
  'logo-list': { desktop: [140, 220], mobile: [200, 320] },
  testimonials: { desktop: [360, 480], mobile: [440, 600] },
  'blog-posts': { desktop: [520, 640], mobile: [900, 1200] },
  'ugc-gallery': { desktop: [440, 580], mobile: [460, 640] },
  loyalty: { desktop: [340, 440], mobile: [420, 560] },
  newsletter: { desktop: [280, 380], mobile: [340, 460] },
  'collection-header': { desktop: [220, 420], mobile: [180, 360] },
  'product-details': { desktop: [420, 680], mobile: [560, 900] },
  'trust-badges': { desktop: [96, 140], mobile: [140, 220] },
  faq: { desktop: [420, 620], mobile: [560, 820] },
  upsell: { desktop: [560, 680], mobile: [580, 760] },
  'recently-viewed': { desktop: [520, 620], mobile: [520, 640] },
  'shipping-bar': { desktop: [56, 76], mobile: [60, 84] },
  'cart-items': { desktop: [360, 640], mobile: [520, 800] },
  'cart-summary': { desktop: [240, 340], mobile: [360, 480] },
  'collection-list': { desktop: [420, 560], mobile: [560, 860] },
  // Fallbacks for types that only appear via APP_CATEGORY_SURFACES or later page types.
  'product-gallery': { desktop: [720, 940], mobile: [420, 520] },
  'buy-box': { desktop: [720, 940], mobile: [680, 960] },
  filters: { desktop: [56, 72], mobile: [52, 64] },
};

function blockHeight(block: Block, device: Device, style: StoreStyle, rng: Rng): number {
  const d = device === 'desktop';
  switch (block.type) {
    case 'header':
      return d
        ? block.hints.layout === 'logo-center'
          ? rng.int(104, 124)
          : rng.int(76, 92)
        : rng.int(56, 68);
    case 'hero': {
      const s = block.hints.style;
      if (s === 'split') return d ? rng.int(560, 720) : rng.int(760, 940);
      if (s === 'video') return d ? rng.int(640, 810) : rng.int(560, 700);
      return d ? rng.int(620, 860) : rng.int(520, 720);
    }
    case 'featured-collection': {
      const products = Number(block.hints.products ?? 4);
      if (d) {
        const card = Math.round((1344 / 4 - 18) * style.cardRatio) + rng.int(88, 104);
        return 200 + Math.ceil(products / 4) * card;
      }
      const card = Math.round(161 * style.cardRatio) + rng.int(96, 120);
      return 170 + Math.min(2, Math.ceil(products / 2)) * card;
    }
    case 'product-grid': {
      const products = Number(block.hints.products ?? 24);
      const sidebar = d && style.filtersLayout === 'sidebar';
      const cols = gridColumns(device, style, products);
      const gridW = d ? (sidebar ? 1040 : 1344) : 346;
      const cardW = gridW / cols - (d ? 24 : 12);
      const card = Math.round(cardW * style.cardRatio) + (d ? rng.int(88, 104) : rng.int(96, 120));
      return Math.ceil(products / cols) * card + (d ? rng.int(100, 140) : rng.int(80, 110));
    }
    case 'reviews':
      if (block.hints.layout === 'carousel') return d ? rng.int(420, 520) : rng.int(480, 620);
      return d ? rng.int(760, 1100) : rng.int(1100, 1600);
    case 'footer': {
      const cols = Number(block.hints.columns ?? 4);
      return d ? 380 + cols * rng.int(44, 56) : 760 + cols * rng.int(100, 140);
    }
    default: {
      const range = SIMPLE[block.type];
      if (!range) throw new Error(`No size for section type ${block.type}`);
      const [min, max] = d ? range.desktop : range.mobile;
      return rng.int(min, max);
    }
  }
}

/** Product grid columns: 2 on mobile; 4 on desktop (3 beside a sidebar unless the page is long). */
function gridColumns(device: Device, style: StoreStyle, products: number): number {
  if (device === 'mobile') return 2;
  return style.filtersLayout === 'sidebar' && products <= 24 ? 3 : 4;
}

/** Two-column row geometry on desktop: [leftX, leftW, rightX, rightW]. */
function columnGeometry(left: SectionType): [number, number, number, number] {
  const content = 1440 - DESKTOP_GUTTER * 2;
  const gap = left === 'filters' ? 40 : 48;
  const leftW =
    left === 'filters' ? 264 : left === 'cart-items' ? 820 : Math.round(content * 0.58 - gap / 2);
  const rightX = DESKTOP_GUTTER + leftW + gap;
  return [DESKTOP_GUTTER, leftW, rightX, 1440 - DESKTOP_GUTTER - rightX];
}

/** Device-specific hint tweaks (e.g. columns collapse on mobile). */
function deviceHints(block: Block, device: Device, style: StoreStyle): Hints {
  const h: Hints = { ...block.hints };
  const d = device === 'desktop';
  switch (block.type) {
    case 'featured-collection':
      h.columns = d ? 4 : 2;
      h.layout = d ? 'grid' : Number(h.products) > 4 ? 'carousel' : 'grid';
      break;
    case 'product-grid':
      h.columns = gridColumns(device, style, Number(h.products ?? 24));
      break;
    case 'filters':
      if (!d) h.layout = 'drawer';
      break;
    case 'image-with-text':
      if (!d) h.image_position = 'top';
      break;
    case 'product-gallery':
      if (!d) h.layout = 'slider';
      break;
    case 'collection-list':
      h.columns = d ? Math.min(Number(h.tiles ?? 3), 4) : 2;
      break;
    default:
      break;
  }
  return h;
}

function placeRows(
  rows: readonly Row[],
  device: Device,
  style: StoreStyle,
  rng: Rng,
  attribute: (type: SectionType) => string | null,
): LayoutSection[] {
  const out: LayoutSection[] = [];
  let y = 0;
  const push = (block: Block, height: number, x: number, w: number | null, column?: string) => {
    const hints = deviceHints(block, device, style);
    if (column) hints.column = column;
    out.push({ type: block.type, y, height, x, w, appSlug: attribute(block.type), hints });
  };
  for (const row of rows) {
    if (row.kind === 'single') {
      const height = blockHeight(row.block, device, style, rng);
      push(row.block, height, 0, null);
      y += height;
      continue;
    }
    if (device === 'desktop') {
      // One row, two rectangles sharing y and height (the taller column sets the row height).
      const height = Math.max(
        blockHeight(row.left, device, style, rng),
        blockHeight(row.right, device, style, rng),
      );
      const [lx, lw, rx, rw] = columnGeometry(row.left.type);
      push(row.left, height, lx, lw, 'left');
      push(row.right, height, rx, rw, 'right');
      y += height;
    } else {
      for (const block of [row.left, row.right]) {
        const height = blockHeight(block, device, style, rng);
        push(block, height, 0, null);
        y += height;
      }
    }
  }
  return out;
}

/** The full capture plan for one curated store: CORE_PAGE_TYPES × DEVICES. */
export function planStoreCaptures(domain: string, apps: readonly LayoutApp[]): LayoutShot[] {
  const style = storeStyle(domain);
  const structures: Record<string, Row[]> = {
    home: homeRows(domain, style, apps),
    collection: collectionRows(domain, style),
    product: productRows(domain, style, apps),
    cart: cartRows(domain, style, apps),
  };
  const shots: LayoutShot[] = [];
  for (const pageType of CORE_PAGE_TYPES) {
    const rows = structures[pageType];
    if (!rows) continue;
    for (const device of DEVICES) {
      const rng = createRng(`${domain}|${pageType}|${device.slug}`);
      const attribute = (type: SectionType): string | null =>
        type === 'header' && pageType !== 'home' ? null : attributionFor(type, apps);
      const sections = placeRows(rows, device.slug, style, rng, attribute);
      const height = sections.reduce((max, s) => Math.max(max, s.y + s.height), 0);
      shots.push({
        pageType,
        device: device.slug,
        viewport: device.viewport,
        width: device.viewport,
        height,
        sections,
      });
    }
  }
  return shots;
}
