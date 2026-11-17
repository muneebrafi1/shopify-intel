import { z } from 'zod';
import {
  AppRefSchema,
  CategoryRefSchema,
  DeviceEnum,
  FacetSchema,
  PageTypeRefSchema,
  ScreenshotDetailSchema,
  ScreenshotThumbSchema,
  SectionTypeRefSchema,
  StoreRefSchema,
  StoreThemeInfoSchema,
  int,
  named,
} from './common.ts';

export const StoreSortEnum = z.enum(['rank', 'apps', 'recent', 'domain']);

export const ListStoresInput = z.object({
  theme: z.string().optional().describe('Theme slug (or slugified detected theme name).'),
  app: z.string().optional().describe('App slug.'),
  category: z.string().optional().describe('Store category slug.'),
  currency: z.string().length(3).optional(),
  country: z.string().length(2).optional(),
  curated: z.boolean().optional().describe('Only curated stores (with a capture plan).'),
  captured: z.boolean().optional().describe('Only stores with real screenshots.'),
  q: z.string().max(100).optional().describe('Domain or name (prefix match).'),
  sort: StoreSortEnum.default('rank'),
  cursor: z.string().optional(),
  limit: int().min(1).max(60).default(24),
});

export const StoreListItemSchema = named(
  'StoreListItem',
  StoreRefSchema.extend({
    url: z.string().describe('Storefront URL (https://<domain> when not crawled).'),
    country: z.string().nullable(),
    currency: z.string().nullable(),
    category: CategoryRefSchema.nullable(),
    tranco_rank: int().nullable(),
    is_captured: z.boolean(),
    theme: StoreThemeInfoSchema,
    app_count: int().describe('Detected apps, including ones without a profile yet.'),
    top_apps: z.array(AppRefSchema).describe('Up to 5 detected apps, most used first.'),
    preview: ScreenshotThumbSchema.nullable().describe('Home page, desktop.'),
    first_seen: z.string(),
    last_seen: z.string(),
    position: int()
      .optional()
      .describe(
        '1-based position in the default catalogue order (sort=rank). Use as the N° label.',
      ),
  }),
);

export const StoreFacetsSchema = z.object({
  themes: z.array(FacetSchema),
  categories: z.array(FacetSchema),
  currencies: z.array(FacetSchema),
  countries: z.array(FacetSchema),
  apps: z.array(FacetSchema),
  curated: int(),
  captured: int(),
});

export const ListStoresOutput = z.object({
  items: z.array(StoreListItemSchema),
  facets: StoreFacetsSchema,
});

export const GetStoreInput = z.object({ domain: z.string().min(3).max(253) });

export const StoreAppSchema = named(
  'StoreApp',
  AppRefSchema.extend({
    confidence: z.number().nullable(),
    first_seen: z.string(),
    last_seen: z.string(),
    seen_in: z
      .array(SectionTypeRefSchema)
      .describe('Section types attributed to this app on this store’s captures.'),
    surfaces: z
      .array(SectionTypeRefSchema)
      .describe('Where apps of this category usually render (taxonomy).'),
  }),
);

export const StorePageSchema = named(
  'StorePage',
  z.object({
    page_type: PageTypeRefSchema,
    url: z.string().nullable(),
    is_placeholder: z.boolean(),
    screenshots: z.object({
      desktop: ScreenshotDetailSchema.nullable(),
      mobile: ScreenshotDetailSchema.nullable(),
    }),
  }),
);

export const SimilarStoreSchema = z.object({
  store: StoreListItemSchema,
  same_theme: z.boolean(),
  shared_apps: int(),
});

export const StoreDetailSchema = named(
  'StoreDetail',
  z.object({
    store: StoreListItemSchema,
    theme: z.object({
      current: StoreThemeInfoSchema,
      history: z.array(
        StoreThemeInfoSchema.extend({
          first_seen: z.string(),
          last_seen: z.string(),
          replaced_at: z.string().nullable(),
        }),
      ),
    }),
    apps: z.object({
      total: int(),
      resolved: int(),
      unresolved: z.object({
        count: int(),
        slugs: z.array(z.string()).describe('Detector slugs we have no app profile for yet.'),
      }),
      groups: z.array(
        z.object({ category: CategoryRefSchema.nullable(), apps: z.array(StoreAppSchema) }),
      ),
    }),
    pixels: z.array(z.object({ slug: z.string(), name: z.string() })),
    pages: z.array(StorePageSchema),
    devices: z.array(DeviceEnum),
    similar: z.array(SimilarStoreSchema),
    teardown: z.object({ slug: z.string(), title: z.string(), href: z.string() }).nullable(),
    detection: z.object({
      first_seen: z.string(),
      last_seen: z.string(),
      source: z.string(),
      rules_version: z.string().nullable(),
    }),
  }),
);

export type ListStoresInput = z.input<typeof ListStoresInput>;
export type StoreListItem = z.infer<typeof StoreListItemSchema>;
export type StoreFacets = z.infer<typeof StoreFacetsSchema>;
export type ListStoresOutput = z.infer<typeof ListStoresOutput>;
export type StoreApp = z.infer<typeof StoreAppSchema>;
export type StorePage = z.infer<typeof StorePageSchema>;
export type SimilarStore = z.infer<typeof SimilarStoreSchema>;
export type StoreDetail = z.infer<typeof StoreDetailSchema>;
