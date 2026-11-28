import { themeLogo } from '~/lib/icons';
/**
 * Helpers for the compare and alternatives pages: neutral summaries built from facts only,
 * fact-matrix cells and explanations, pair-card lines, and the "Seen on" capture frames.
 * Nothing here ranks one side above the other.
 */
import type {
  AppDetail,
  AppListItem,
  ComparisonDetail,
  MatrixRow,
  ResponseMeta,
  SectionCard,
  ThemeDetail,
  ThemeListItem,
} from '~/server/api/v1/types';
import { formatCount, formatDate, formatPrice } from '~/lib/format';
import { CORE_PAGE_TYPES, PAGE_TYPES, type Device, type PageType } from '~/lib/taxonomy';

export type Side = 'a' | 'b';

export const pageTypeName = (slug: string): string =>
  PAGE_TYPES.find((p) => p.slug === slug)?.name ?? slug;

export const pluralStores = (n: number) => `${formatCount(n)} ${n === 1 ? 'store' : 'stores'}`;

/** 0.2376 → "23.8%"; tiny shares keep a decimal so they never read as 0. */
export const sharePct = (share: number) => {
  const pct = share * 100;
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1).replace(/\.0$/, '')}%`;
};

// ---------------------------------------------------------------------------------------------
// Identity of each side
// ---------------------------------------------------------------------------------------------
export interface SideInfo {
  side: Side;
  kind: 'app' | 'theme';
  slug: string;
  name: string;
  fullName: string;
  href: string;
  iconUrl: string | null;
  /** Developer (apps) or vendor (themes). */
  maker: string | null;
  makerHref: string | null;
  stores: number;
  share: number;
  denominator: number;
  rank: number | null;
  alternativesHref: string;
}

export function sides(cmp: ComparisonDetail): [SideInfo, SideInfo] {
  const pick = (side: Side): SideInfo => {
    if (cmp.apps) {
      const d = cmp.apps[side].app;
      return {
        side,
        kind: 'app',
        slug: d.slug,
        name: d.short_name,
        fullName: d.name,
        href: d.href,
        iconUrl: d.icon_url,
        maker: d.developer,
        makerHref: null,
        stores: d.usage.stores,
        share: d.usage.share,
        denominator: d.usage.denominator,
        rank: d.usage.rank,
        alternativesHref: `/alternatives/${d.slug}`,
      };
    }
    const t = cmp.themes![side].theme;
    return {
      side,
      kind: 'theme',
      slug: t.slug,
      name: t.name,
      fullName: t.name,
      href: t.href,
      iconUrl: themeLogo(t.slug)?.src ?? null,
      maker: t.vendor,
      makerHref: t.vendor_info?.href ?? null,
      stores: t.usage.stores,
      share: t.usage.share,
      denominator: t.usage.denominator,
      rank: t.usage.rank,
      alternativesHref: `/alternatives/${t.slug}`,
    };
  };
  return [pick('a'), pick('b')];
}

// ---------------------------------------------------------------------------------------------
// Neutral summaries (facts only, no adjectives, no verdict)
// ---------------------------------------------------------------------------------------------
/** One line under the page title. */
export function summary(cmp: ComparisonDetail): string {
  const [a, b] = sides(cmp);
  const usage =
    `${a.name} is detected on ${formatCount(a.stores)} of ${formatCount(a.denominator)} scanned stores, ` +
    `${b.name} on ${formatCount(b.stores)}`;
  if (cmp.apps) {
    const ca = cmp.apps.a.app.category?.name;
    const cb = cmp.apps.b.app.category?.name;
    const what =
      ca && ca === cb
        ? `Both are ${ca} apps.`
        : `${a.name} is ${ca ? `a ${ca} app` : 'an app'}; ${b.name} is ${cb ? `a ${cb} app` : 'an app'}.`;
    const both = cmp.shared_stores.total;
    const tail =
      both > 0 ? `; ${pluralStores(both)} run both.` : '; no store in the scan runs both.';
    return `${what} ${usage}${tail}`;
  }
  const ta = cmp.themes!.a.theme;
  const tb = cmp.themes!.b.theme;
  const maker =
    ta.vendor && ta.vendor === tb.vendor
      ? `Both are ${ta.vendor} themes`
      : `${a.name} is by ${ta.vendor ?? 'an unknown vendor'}, ${b.name} by ${tb.vendor ?? 'an unknown vendor'}`;
  const pa = priceWords(ta.price.label, ta.price.is_free);
  const pb = priceWords(tb.price.label, tb.price.is_free);
  const price =
    pa === pb
      ? `, ${pa === 'free' ? 'both free' : `both ${pa}`}.`
      : `; ${a.name} is ${pa}, ${b.name} ${pb}.`;
  return `${maker}${price} ${usage}.`;
}

const priceWords = (label: string | null, free: boolean | null) =>
  free ? 'free' : label ? label : 'priced on request';

/** The closing "In short" list: one plain sentence per fact, never a recommendation. */
export function factSentences(cmp: ComparisonDetail): string[] {
  const [a, b] = sides(cmp);
  const out: string[] = [];
  if (cmp.apps) {
    const x = cmp.apps.a.app;
    const y = cmp.apps.b.app;
    const price = (app: typeof x) => {
      const free = app.pricing.free_plan;
      const from = app.pricing.from_cents;
      if (free === null && from === null) return `${app.short_name} lists no pricing we could read`;
      const parts = [
        free === true ? 'has a free plan' : free === false ? 'has no free plan' : null,
        from ? `paid plans from ${formatPrice(from)}/mo` : null,
      ].filter(Boolean);
      return `${app.short_name} ${parts.join('; ')}`;
    };
    out.push(`${price(x)}. ${price(y)}.`);
    if (x.rating !== null && y.rating !== null)
      out.push(
        `On the App Store, ${x.short_name} is rated ${x.rating.toFixed(1)} from ${formatCount(x.reviews ?? 0)} reviews and ${y.short_name} ${y.rating.toFixed(1)} from ${formatCount(y.reviews ?? 0)}.`,
      );
    if (x.built_for_shopify !== null && y.built_for_shopify !== null) {
      out.push(
        x.built_for_shopify && y.built_for_shopify
          ? 'Both carry the Built for Shopify badge.'
          : !x.built_for_shopify && !y.built_for_shopify
            ? 'Neither carries the Built for Shopify badge.'
            : `${x.built_for_shopify ? x.short_name : y.short_name} carries the Built for Shopify badge; ${x.built_for_shopify ? y.short_name : x.short_name} does not.`,
      );
    }
    out.push(
      `${a.name} is on ${formatCount(a.stores)} stores, ${b.name} on ${formatCount(b.stores)}; ${cmp.shared_stores.total > 0 ? `${pluralStores(cmp.shared_stores.total)} run both` : 'none run both'}.`,
    );
    const sa = cmp.apps.a.seen_on.section_total;
    const sb = cmp.apps.b.seen_on.section_total;
    if (sa + sb > 0)
      out.push(
        `${formatCount(sa)} ${sa === 1 ? 'section' : 'sections'} on stores running ${a.name}, ${formatCount(sb)} on ${b.name}.`,
      );
    return out;
  }
  const ta = cmp.themes!.a;
  const tb = cmp.themes!.b;
  out.push(
    ta.theme.vendor && ta.theme.vendor === tb.theme.vendor
      ? `Both are ${ta.theme.vendor} themes.`
      : `${a.name} is by ${ta.theme.vendor ?? 'an unknown vendor'}; ${b.name} is by ${tb.theme.vendor ?? 'an unknown vendor'}.`,
  );
  const pa = priceWords(ta.theme.price.label, ta.theme.price.is_free);
  const pb = priceWords(tb.theme.price.label, tb.theme.price.is_free);
  out.push(
    pa === pb
      ? `Both are ${pa} at list price.`
      : `${a.name} is ${pa} and ${b.name} is ${pb} at list price.`,
  );
  out.push(
    `${a.name} is on ${formatCount(a.stores)} stores, ${b.name} on ${formatCount(b.stores)}; ${cmp.shared_stores.total > 0 ? `${pluralStores(cmp.shared_stores.total)} have run both` : 'none have run both'}.`,
  );
  out.push(
    `${ta.versions.length} ${ta.versions.length === 1 ? 'version' : 'versions'} of ${a.name}, ${tb.versions.length} of ${b.name}.`,
  );
  if (cmp.shared_apps.length > 0)
    out.push(
      `${cmp.shared_apps.length} ${cmp.shared_apps.length === 1 ? 'app is' : 'apps are'} common on both, led by ${cmp.shared_apps[0]!.app.short_name}.`,
    );
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pair cards (index, related): one factual line that tells the two apart
// ---------------------------------------------------------------------------------------------
const perMonth = (cents: number) => `${formatPrice(cents)}`;

export function appPairLine(a: AppListItem, b: AppListItem): string {
  const fa = a.pricing.free_plan;
  const fb = b.pricing.free_plan;
  if (fa !== null && fb !== null && fa !== fb)
    return `Free plan on ${fa ? a.short_name : b.short_name} only`;
  const pa = a.pricing.from_cents;
  const pb = b.pricing.from_cents;
  if (pa && pb)
    return pa === pb
      ? `Both from ${perMonth(pa)}/mo`
      : `Paid plans from ${perMonth(pa)} and ${perMonth(pb)}/mo`;
  const ba = a.built_for_shopify;
  const bb = b.built_for_shopify;
  if (ba !== null && bb !== null && ba !== bb)
    return `Built for Shopify badge on ${ba ? a.short_name : b.short_name} only`;
  if (a.rating !== null && b.rating !== null)
    return `Rated ${a.rating.toFixed(1)} and ${b.rating.toFixed(1)} on the App Store`;
  if (a.developer && b.developer && a.developer !== b.developer)
    return `By ${a.developer} and ${b.developer}`;
  return 'Usage from our scan; listing details not collected yet';
}

export function themePairLine(a: ThemeListItem, b: ThemeListItem): string {
  const pa = a.price.is_free ? 'free' : (a.price.label ?? 'price not listed');
  const pb = b.price.is_free ? 'free' : (b.price.label ?? 'price not listed');
  const price = pa === pb ? (pa === 'free' ? 'both free' : `both ${pa}`) : `${pa} and ${pb}`;
  if (a.vendor && a.vendor === b.vendor) return `Both by ${a.vendor}, ${price}`;
  const makers = [a.vendor, b.vendor].filter(Boolean);
  return makers.length === 2
    ? `By ${makers[0]} and ${makers[1]}, ${price}`
    : `${price.charAt(0).toUpperCase()}${price.slice(1)}`;
}

// ---------------------------------------------------------------------------------------------
// Fact matrix
// ---------------------------------------------------------------------------------------------
export type Cell =
  { mark: 'yes' | 'no' | 'none'; text: string } | { mark?: undefined; text: string };

export function matrixCell(row: MatrixRow, side: Side, denominator: number): Cell {
  const v = row[side];
  const shown = side === 'a' ? row.a_display : row.b_display;
  if (typeof v === 'boolean') return { mark: v ? 'yes' : 'no', text: v ? 'Yes' : 'No' };
  if (v === null || shown === '—') return { mark: 'none', text: 'Not listed' };
  switch (row.key) {
    case 'launched_on':
      return { text: typeof v === 'string' ? formatDate(v) : shown };
    case 'languages':
      return { text: `${shown} ${v === 1 ? 'language' : 'languages'}` };
    case 'stores':
      return { text: `${shown} of ${formatCount(denominator)}` };
    default:
      return { text: shown };
  }
}

/** One-line explanation under each matrix label (Vercel pattern). */
export const ROW_HELP: Record<string, string> = {
  category: 'Category on the Shopify App Store',
  developer: 'Who publishes the listing',
  rating: 'Average star rating on the listing',
  reviews: 'Ratings behind that average',
  free_plan: 'A plan that costs nothing per month',
  from_price: 'Cheapest paid plan, per month in USD',
  trial_days: 'Free trial on paid plans',
  built_for_shopify: 'Shopify’s badge on the listing',
  launched_on: 'When the listing went live',
  languages: 'Languages the app is offered in',
  stores: 'Scanned stores where we detect it now',
  share: 'Those stores as a share of all scanned',
  sections: 'Sections attributed on captured pages',
  vendor: 'Who makes and sells the theme',
  price: 'One-time list price from the vendor',
  marketplace: 'Where the theme is sold',
  versions: 'Distinct versions detected on live stores',
  curated: 'Stores we capture page by page',
};

export interface MatrixGroup {
  source: string;
  label: string;
  asOf: string | null;
  n: number;
  rows: MatrixRow[];
}

const SOURCE_SHORT: Array<[RegExp, string]> = [
  [/^shopify-app-store/, 'App Store listing'],
  [/^storepeek-scan/, 'Our scan'],
  [/^capture-plan/, 'Section library'],
  [/^editorial/, 'Listing'],
];

/** Rows grouped by source, in the order the API lists them, numbered for footnotes. */
export function matrixGroups(rows: MatrixRow[], meta: ResponseMeta): MatrixGroup[] {
  const groups: MatrixGroup[] = [];
  for (const row of rows) {
    let g = groups.find((x) => x.source === row.source);
    if (!g) {
      const src = meta.sources[row.source];
      g = {
        source: row.source,
        label: SOURCE_SHORT.find(([re]) => re.test(row.source))?.[1] ?? src?.label ?? row.source,
        asOf: src?.as_of ?? null,
        n: groups.length + 1,
        rows: [],
      };
      groups.push(g);
    }
    g.rows.push(row);
  }
  return groups;
}

export const sourceShort = (key: string, fallback: string) =>
  SOURCE_SHORT.find(([re]) => re.test(key))?.[1] ?? fallback;

// ---------------------------------------------------------------------------------------------
// "Seen on" frames: captures from stores using each side, same scale, with pinned tags
// ---------------------------------------------------------------------------------------------
export interface PinnedTag {
  label: string;
  /** Position on the frame, in % of its height. */
  top: number;
  height: number;
  /** Section height as a share of the capture width (to hide tags that wouldn't fit). */
  hw?: number;
}

export interface Frame {
  /** 'crop' = a section slice; 'page' = the top of a full-page capture. */
  kind: 'crop' | 'page';
  src: string;
  width: number;
  height: number;
  href: string | null;
  device: Device;
  pageType: PageType;
  /** Store the capture comes from. */
  domain: string;
  storeName: string;
  storeHref: string;
  /** Path shown in the window's URL pill. */
  path: string;
  /** Theme or version line for the caption. */
  context: string | null;
  tags: PinnedTag[];
  isPlaceholder: boolean;
  alt: string;
}

export interface StageModel {
  mode: 'sections' | 'pages' | 'stores' | 'empty';
  pageTypes: PageType[];
  devices: Device[];
  /** key `${page}:${device}` → frames per side (null = nothing on that side). */
  frames: Map<string, { a: Frame | null; b: Frame | null; sectionType: string | null }>;
  defaultKey: string;
  note: string;
}

export const frameKey = (page: string, device: string) => `${page}:${device}`;

const DEVICES: Device[] = ['desktop', 'mobile'];

const PAGE_PATH: Record<string, string> = {
  home: '/',
  collection: '/collections/all',
  product: '/products/…',
  cart: '/cart',
};

function cropFrame(app: AppDetail, s: SectionCard): Frame {
  return {
    kind: 'crop',
    src: s.crop.src,
    width: s.crop.width,
    height: s.crop.height,
    href: s.href,
    device: s.device,
    pageType: s.page_type,
    domain: s.store.domain,
    storeName: s.store.display_name,
    storeHref: s.store.href,
    path: PAGE_PATH[s.page_type] ?? '/',
    context: s.theme ? `${s.theme.name} theme` : 'Custom theme',
    tags: [{ label: `${s.type.name} · ${app.app.short_name}`, top: 0, height: 100 }],
    isPlaceholder: s.is_placeholder,
    alt: `${s.type.name} section rendered by ${app.app.short_name} on ${s.store.display_name}, ${pageTypeName(s.page_type).toLowerCase()} page, ${s.device}`,
  };
}

/** App pairs: section crops each app renders on curated stores, same section type where possible. */
export function appStage(a: AppDetail, b: AppDetail): StageModel {
  const secs = { a: a.seen_on.sections, b: b.seen_on.sections };
  if (secs.a.length + secs.b.length === 0) return appStoresStage(a, b);

  const pages = CORE_PAGE_TYPES.filter((p) =>
    [...secs.a, ...secs.b].some((s) => s.page_type === p),
  );
  const frames: StageModel['frames'] = new Map();
  let best: { key: string; score: number } | null = null;
  for (const page of pages) {
    for (const device of DEVICES) {
      const sa = secs.a.filter((s) => s.page_type === page && s.device === device);
      const sb = secs.b.filter((s) => s.page_type === page && s.device === device);
      if (!sa.length && !sb.length) continue;
      // Prefer a section type both apps render on this page.
      const common = sa.find((s) => sb.some((t) => t.type.slug === s.type.slug))?.type.slug ?? null;
      const fa = (common ? sa.find((s) => s.type.slug === common) : sa[0]) ?? null;
      const fb = (common ? sb.find((s) => s.type.slug === common) : sb[0]) ?? null;
      const key = frameKey(page, device);
      frames.set(key, {
        a: fa ? cropFrame(a, fa) : null,
        b: fb ? cropFrame(b, fb) : null,
        sectionType: common ? (fa?.type.name ?? null) : null,
      });
      // Default: both sides filled, same type, desktop, product page first.
      const score =
        (fa && fb ? 10 : 0) +
        (common ? 5 : 0) +
        (device === 'desktop' ? 2 : 0) +
        (page === 'product' ? 1 : 0);
      if (!best || score > best.score) best = { key, score };
    }
  }
  const devices = DEVICES.filter((d) => [...frames.keys()].some((k) => k.endsWith(`:${d}`)));
  return {
    mode: 'sections',
    pageTypes: pages,
    devices,
    frames,
    defaultKey: best?.key ?? frameKey(pages[0] ?? 'home', 'desktop'),
    note: 'Where each app renders on curated stores: the same section type where both have one, cropped from the page and shown at the same scale.',
  };
}

const PAGE_CROP: Record<Device, number> = { desktop: 1.1, mobile: 2.3 };

/** Fallback for apps without a visible section: the home page of a curated store running each. */
function appStoresStage(a: AppDetail, b: AppDetail): StageModel {
  const first = (d: AppDetail): Frame | null => {
    const s = d.seen_on.stores.find((x) => x.preview);
    if (!s?.preview) return null;
    const img = s.preview.image;
    return {
      kind: 'page',
      src: img.src,
      width: img.width,
      height: Math.min(img.height, Math.round(img.width * PAGE_CROP.desktop)),
      href: s.store.href,
      device: 'desktop',
      pageType: 'home',
      domain: s.store.domain,
      storeName: s.store.display_name,
      storeHref: s.store.href,
      path: '/',
      context: `runs ${d.app.short_name}, no visible section attributed`,
      tags: [],
      isPlaceholder: s.preview.is_placeholder,
      alt: `Home page of ${s.store.display_name}, a store running ${d.app.short_name}, desktop`,
    };
  };
  const fa = first(a);
  const fb = first(b);
  const key = frameKey('home', 'desktop');
  const frames: StageModel['frames'] = new Map([[key, { a: fa, b: fb, sectionType: null }]]);
  return {
    mode: fa || fb ? 'stores' : 'empty',
    pageTypes: ['home'],
    devices: ['desktop'],
    frames,
    defaultKey: key,
    note:
      fa || fb
        ? 'Neither app has a section we can attribute on curated stores, so this shows the home page of a store running each.'
        : 'Neither app runs on a curated store yet, so there is nothing to show side by side.',
  };
}

/** Theme pairs: the same page type of a curated store on each theme, with its sections pinned. */
export function themeStage(a: ThemeDetail, b: ThemeDetail): StageModel {
  // The curated store with the most sampled sections, so its captures carry pinned tags.
  const storeOf = (t: ThemeDetail) => {
    const tagged = (domain: string) =>
      t.sections.items.filter((x) => x.store.domain === domain).length;
    return (
      [...t.curated_stores].sort((x, y) => tagged(y.store.domain) - tagged(x.store.domain))[0] ??
      null
    );
  };
  const sa = storeOf(a);
  const sb = storeOf(b);
  const pages = CORE_PAGE_TYPES.filter((p) =>
    [sa, sb].some((s) => s?.pages.some((pg) => pg.page_type === p && (pg.desktop || pg.mobile))),
  );
  const frames: StageModel['frames'] = new Map();
  const make = (t: ThemeDetail, page: PageType, device: Device): Frame | null => {
    const s = storeOf(t);
    const shot = s?.pages.find((pg) => pg.page_type === page)?.[device];
    if (!s || !shot) return null;
    const cropH = Math.min(shot.image.height, Math.round(shot.image.width * PAGE_CROP[device]));
    // Pin the sections we know on this exact screenshot that start inside the crop.
    const tags = t.sections.items
      .filter((x) => x.screenshot.id === shot.id && x.rect.y < cropH - 40)
      .sort((x, y) => x.rect.y - y.rect.y)
      .map((x) => ({
        label: x.type.name,
        top: (x.rect.y / cropH) * 100,
        height: (Math.min(x.rect.h, cropH - x.rect.y) / cropH) * 100,
        hw: x.rect.h / shot.image.width,
      }));
    return {
      kind: 'page',
      src: shot.image.src,
      width: shot.image.width,
      height: cropH,
      href: `${s.store.href}?page=${page}&device=${device}`,
      device,
      pageType: page,
      domain: s.store.domain,
      storeName: s.store.display_name,
      storeHref: s.store.href,
      path: PAGE_PATH[page] ?? '/',
      context: `on ${s.version ? `${t.theme.name} ${s.version}` : t.theme.name}`,
      tags,
      isPlaceholder: shot.is_placeholder,
      alt: `${pageTypeName(page)} page of ${s.store.display_name} on ${t.theme.name}, ${device}`,
    };
  };
  for (const page of pages) {
    for (const device of DEVICES) {
      const fa = make(a, page, device);
      const fb = make(b, page, device);
      if (fa || fb) frames.set(frameKey(page, device), { a: fa, b: fb, sectionType: null });
    }
  }
  const has = frames.size > 0;
  const def = frames.has(frameKey('home', 'desktop'))
    ? frameKey('home', 'desktop')
    : ([...frames.keys()][0] ?? frameKey('home', 'desktop'));
  if (!has) frames.set(def, { a: null, b: null, sectionType: null });
  return {
    mode: has ? 'pages' : 'empty',
    pageTypes: has ? pages : ['home'],
    devices: has
      ? DEVICES.filter((d) => [...frames.keys()].some((k) => k.endsWith(`:${d}`)))
      : ['desktop'],
    frames,
    defaultKey: def,
    note: has
      ? 'The same page of a curated store on each theme, top of the page, at the same scale. Tags mark the sections we detected.'
      : 'Neither theme has a curated store yet, so there is nothing to show side by side.',
  };
}
