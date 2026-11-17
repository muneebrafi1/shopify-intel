import { z } from 'zod';
import {
  AppRefSchema,
  ComparisonLinkSchema,
  CtaSchema,
  FacetSchema,
  PageTypeEnum,
  PriceSchema,
  ScreenshotThumbSchema,
  SectionCardSchema,
  SectionTypeRefSchema,
  StoreRefSchema,
  ThemeRefSchema,
  UsageStatSchema,
  facetsFlag,
  int,
  named,
  pagedList,
} from './common.ts';

export const PriceBandEnum = z.enum(['free', 'under-300', '300-399', '400-plus']);

export const ListThemesInput = z.object({
  price: z.enum(['free', 'paid']).optional(),
  price_band: PriceBandEnum.optional(),
  vendor: z.string().optional().describe('Vendor slug.'),
  q: z.string().max(100).optional(),
  slugs: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe('Only these themes: slugs, comma-separated in a query string (up to 100).'),
  sort: z.enum(['usage', 'name', 'price']).default('usage'),
  cursor: z.string().optional(),
  limit: int().min(1).max(100).default(48),
  facets: facetsFlag('vendors and price_bands come back empty'),
});

export const VendorSchema = z.object({ name: z.string(), slug: z.string(), href: z.string() });

export const ThemeListItemSchema = named(
  'ThemeListItem',
  ThemeRefSchema.extend({
    vendor_info: VendorSchema.nullable(),
    price: PriceSchema,
    marketplace: z.string().nullable(),
    theme_store_id: int().nullable(),
    usage: UsageStatSchema,
    curated_store_count: int(),
    previews: z
      .array(ScreenshotThumbSchema)
      .describe('Up to 3 home-page desktop shots of curated stores using the theme.'),
    cta: CtaSchema.nullable(),
  }),
);

export const ListThemesOutput = z.object({
  items: z.array(ThemeListItemSchema),
  facets: z.object({ vendors: z.array(FacetSchema), price_bands: z.array(FacetSchema) }),
});

export const GetThemeInput = z.object({
  slug: z.string(),
  stores_limit: int().min(0).max(60).default(24),
});

export const ListThemeStoresInput = z.object({
  slug: z.string(),
  cursor: z.string().optional(),
  limit: int().min(1).max(100).default(48),
});

export const ThemeStoreRowSchema = named(
  'ThemeStoreRow',
  z.object({
    store: StoreRefSchema,
    version: z.string().nullable(),
    app_count: int(),
    is_captured: z.boolean(),
    has_capture_plan: z.boolean(),
  }),
);

export const CuratedStoreShotsSchema = named(
  'CuratedStoreShots',
  z.object({
    store: StoreRefSchema,
    version: z.string().nullable(),
    pages: z.array(
      z.object({
        page_type: PageTypeEnum,
        desktop: ScreenshotThumbSchema.nullable(),
        mobile: ScreenshotThumbSchema.nullable(),
      }),
    ),
  }),
);

export const ThemeDetailSchema = named(
  'ThemeDetail',
  z.object({
    theme: ThemeListItemSchema,
    official_url: z.string().nullable(),
    versions: z.array(z.object({ version: z.string().nullable(), stores: int() })),
    curated_stores: z.array(CuratedStoreShotsSchema),
    stores: pagedList(ThemeStoreRowSchema),
    top_apps: z
      .array(z.object({ app: AppRefSchema, stores: int(), share: z.number() }))
      .describe('Apps most used by stores on this theme; share = of the theme’s stores.'),
    sections: z.object({
      total: int(),
      by_type: z.array(z.object({ type: SectionTypeRefSchema, count: int() })),
      items: z.array(SectionCardSchema),
    }),
    similar: z.array(
      z.object({
        theme: ThemeListItemSchema,
        reasons: z.array(z.enum(['same-vendor', 'similar-price', 'shared-apps'])),
        score: z.number(),
      }),
    ),
    presets: z.array(z.object({ slug: z.string(), name: z.string() })),
    tags: z.object({ style: z.array(z.string()), industry: z.array(z.string()) }),
    comparisons: z.array(ComparisonLinkSchema),
  }),
);

export type ListThemesInput = z.input<typeof ListThemesInput>;
export type ThemeListItem = z.infer<typeof ThemeListItemSchema>;
export type ListThemesOutput = z.infer<typeof ListThemesOutput>;
export type ThemeStoreRow = z.infer<typeof ThemeStoreRowSchema>;
export type CuratedStoreShots = z.infer<typeof CuratedStoreShotsSchema>;
export type ThemeDetail = z.infer<typeof ThemeDetailSchema>;
export type PriceBand = z.infer<typeof PriceBandEnum>;
