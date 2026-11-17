/**
 * Shared response building blocks. Every schema registered with `named()` becomes a reusable
 * component in the OpenAPI document (/api/v1/openapi.json).
 */
import { z } from 'zod';
import { DEVICES, PAGE_TYPES, SECTION_GROUPS, SECTION_TYPES } from '../../../../lib/taxonomy.ts';

export const schemaRegistry = z.registry<{ id: string; description?: string }>();

/** Registers a schema as a named OpenAPI component. */
export function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  schemaRegistry.add(schema, description ? { id, description } : { id });
  return schema;
}

const slugs = <T extends ReadonlyArray<{ slug: string }>>(items: T) =>
  items.map((i) => i.slug) as unknown as [T[number]['slug'], ...Array<T[number]['slug']>];

export const PageTypeEnum = z.enum(slugs(PAGE_TYPES));
export const DeviceEnum = z.enum(slugs(DEVICES));
export const SectionTypeEnum = z.enum(slugs(SECTION_TYPES));
export const SectionGroupEnum = z.enum(slugs(SECTION_GROUPS));

export const int = () => z.number().int();

/** Free-form layout hints for renderers (see docs/API.md). */
export const HintsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const ImageSchema = named(
  'Image',
  z.object({
    src: z.string().describe('URL path of the image (placeholder SVG until captured).'),
    width: int().describe('Intrinsic width in CSS px; reserve this aspect ratio.'),
    height: int(),
    is_placeholder: z.boolean(),
  }),
  'An image with its intrinsic size so the UI can reserve space before it loads.',
);

export const SourceSchema = named(
  'Source',
  z.object({ label: z.string(), as_of: z.string(), url: z.string().nullable() }),
  'Where a number comes from. Keyed by id in meta.sources; stats reference the id.',
);

export const UsageStatSchema = named(
  'UsageStat',
  z.object({
    stores: int().describe('Active scanned stores where it is currently detected.'),
    share: z.number().describe('stores / denominator, 0..1.'),
    denominator: int().describe('Active scanned stores the share is measured against.'),
    rank: int().nullable(),
    source: z.string().describe('Key into meta.sources.'),
    as_of: z.string(),
  }),
);

export const CategoryRefSchema = named(
  'CategoryRef',
  z.object({ slug: z.string(), name: z.string(), href: z.string() }),
);

export const StoreRefSchema = named(
  'StoreRef',
  z.object({
    domain: z.string(),
    name: z.string().nullable().describe('Editorial name; null when unknown.'),
    display_name: z.string().describe('name, or the domain when the name is unknown.'),
    href: z.string(),
    is_curated: z.boolean(),
  }),
);

export const ThemeRefSchema = named(
  'ThemeRef',
  z.object({ slug: z.string(), name: z.string(), vendor: z.string().nullable(), href: z.string() }),
);

export const AppRefSchema = named(
  'AppRef',
  z.object({
    slug: z.string(),
    name: z.string().describe('Full App Store listing name.'),
    short_name: z.string().describe("Brand part of the name, e.g. 'Klaviyo'."),
    icon_url: z.string().nullable(),
    href: z.string(),
    category: CategoryRefSchema.nullable(),
  }),
);

export const SectionTypeRefSchema = named(
  'SectionTypeRef',
  z.object({
    slug: SectionTypeEnum,
    name: z.string(),
    group: z.object({ slug: SectionGroupEnum, name: z.string() }),
    href: z.string(),
  }),
);

export const PageTypeRefSchema = named(
  'PageTypeRef',
  z.object({ slug: PageTypeEnum, name: z.string() }),
);

/** Generic link target used in comparison / alternative lists for both apps and themes. */
export const EntityRefSchema = named(
  'EntityRef',
  z.object({
    kind: z.enum(['app', 'theme']),
    slug: z.string(),
    name: z.string(),
    icon_url: z.string().nullable(),
    href: z.string(),
  }),
);

export const CtaSchema = named(
  'Cta',
  z.object({
    href: z.string().describe('/go/<id> for affiliate links (click is logged), else the official URL.'),
    label: z.string(),
    is_affiliate: z.boolean(),
    rel: z.string().describe('Use as the anchor rel attribute.'),
    disclosure: z.string().nullable(),
  }),
  'Primary call to action. Affiliate links are always labelled.',
);

export const FacetSchema = named(
  'Facet',
  z.object({ value: z.string(), label: z.string(), count: int() }),
);

export const PageInfoSchema = named(
  'PageInfo',
  z.object({
    limit: int(),
    next_cursor: z.string().nullable().describe('Pass as ?cursor= to get the next page.'),
    total: int().nullable(),
  }),
);

/** A paginated sub-list embedded in a detail response. */
export const pagedList = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable(), total: int() });

export const ScreenshotThumbSchema = named(
  'ScreenshotThumb',
  z.object({
    id: int(),
    page_type: PageTypeEnum,
    device: DeviceEnum,
    is_placeholder: z.boolean(),
    captured_at: z.string().nullable(),
    image: ImageSchema,
  }),
);

export const RectSchema = z.object({ x: int(), y: int(), w: int(), h: int() });

export const SectionCardSchema = named(
  'SectionCard',
  z.object({
    id: int(),
    href: z.string(),
    type: SectionTypeRefSchema,
    page_type: PageTypeEnum,
    device: DeviceEnum,
    rect: RectSchema.describe('Rectangle on the full-page screenshot, CSS px.'),
    crop: ImageSchema,
    screenshot: z.object({ id: int(), width: int(), height: int(), image: ImageSchema }),
    store: StoreRefSchema,
    theme: ThemeRefSchema.nullable(),
    app: AppRefSchema.nullable(),
    hints: HintsSchema.nullable(),
    is_placeholder: z.boolean(),
  }),
  'A sliced section with its crop, the page it came from and who renders it.',
);

export const ShotSectionSchema = named(
  'ShotSection',
  z.object({
    id: int(),
    href: z.string(),
    type: SectionTypeRefSchema,
    rect: RectSchema,
    order_index: int(),
    column: z.enum(['left', 'right']).nullable(),
    app: AppRefSchema.nullable(),
    theme_section_name: z.string().nullable(),
    hints: HintsSchema.nullable(),
    is_placeholder: z.boolean(),
    crop: ImageSchema,
  }),
);

export const ScreenshotDetailSchema = named(
  'ScreenshotDetail',
  z.object({
    id: int(),
    page_type: PageTypeRefSchema,
    device: DeviceEnum,
    viewport_w: int(),
    width: int(),
    height: int(),
    is_placeholder: z.boolean(),
    is_current: z.boolean(),
    captured_at: z.string().nullable(),
    image: ImageSchema,
    store: StoreRefSchema,
    theme: ThemeRefSchema.nullable(),
    sections: z.array(ShotSectionSchema),
  }),
  'A full-page screenshot (or planned placeholder) with every section on it.',
);

export const StoreThemeInfoSchema = named(
  'StoreThemeInfo',
  z.object({
    theme: ThemeRefSchema.nullable().describe('Null when we have no record for the theme.'),
    name: z.string().nullable().describe('Detected theme name.'),
    version: z.string().nullable(),
    is_custom: z.boolean(),
    label: z.string().describe("Display label, e.g. 'Prestige 9.3.0' or 'Custom theme'."),
  }),
);

export const ComparisonLinkSchema = named(
  'ComparisonLink',
  z.object({
    slug: z.string(),
    href: z.string(),
    kind: z.enum(['app', 'theme']),
    title: z.string(),
    reason: z.string(),
    a: EntityRefSchema,
    b: EntityRefSchema,
  }),
);

export const PriceSchema = named(
  'Price',
  z.object({
    cents: int().nullable().describe('USD cents; 0 = free; null = unknown.'),
    label: z.string().nullable(),
    is_free: z.boolean().nullable(),
  }),
);

export type Image = z.infer<typeof ImageSchema>;
export type UsageStat = z.infer<typeof UsageStatSchema>;
export type CategoryRef = z.infer<typeof CategoryRefSchema>;
export type StoreRef = z.infer<typeof StoreRefSchema>;
export type ThemeRef = z.infer<typeof ThemeRefSchema>;
export type AppRef = z.infer<typeof AppRefSchema>;
export type SectionTypeRef = z.infer<typeof SectionTypeRefSchema>;
export type PageTypeRef = z.infer<typeof PageTypeRefSchema>;
export type EntityRef = z.infer<typeof EntityRefSchema>;
export type Cta = z.infer<typeof CtaSchema>;
export type Facet = z.infer<typeof FacetSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
export type ScreenshotThumb = z.infer<typeof ScreenshotThumbSchema>;
export type SectionCard = z.infer<typeof SectionCardSchema>;
export type ShotSection = z.infer<typeof ShotSectionSchema>;
export type ScreenshotDetail = z.infer<typeof ScreenshotDetailSchema>;
export type StoreThemeInfo = z.infer<typeof StoreThemeInfoSchema>;
export type ComparisonLink = z.infer<typeof ComparisonLinkSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type Hints = z.infer<typeof HintsSchema>;
export type Rect = z.infer<typeof RectSchema>;
