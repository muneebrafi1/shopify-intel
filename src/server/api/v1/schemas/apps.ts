import { z } from 'zod';
import {
  AppRefSchema,
  CategoryRefSchema,
  ComparisonLinkSchema,
  CtaSchema,
  FacetSchema,
  ScreenshotThumbSchema,
  SectionCardSchema,
  SectionTypeRefSchema,
  StoreRefSchema,
  StoreThemeInfoSchema,
  ThemeRefSchema,
  UsageStatSchema,
  int,
  named,
  pagedList,
} from './common.ts';

export const ListAppsInput = z.object({
  category: z.string().optional().describe('App category slug.'),
  price: z.enum(['free', 'paid']).optional().describe('free = has a free plan.'),
  built_for_shopify: z.boolean().optional(),
  min_rating: z.number().min(0).max(5).optional(),
  profile: z.enum(['full', 'basic']).optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(['usage', 'rating', 'reviews', 'name']).default('usage'),
  cursor: z.string().optional(),
  limit: int().min(1).max(100).default(48),
});

export const AppPricingSchema = named(
  'AppPricing',
  z.object({
    free_plan: z.boolean().nullable(),
    from_cents: int().nullable().describe('Cheapest paid plan per month, USD cents.'),
    label: z.string().nullable().describe("e.g. 'Free plan · from $15/mo'."),
    trial_days: int().nullable(),
  }),
);

export const AppListItemSchema = named(
  'AppListItem',
  AppRefSchema.extend({
    developer: z.string().nullable(),
    tagline: z.string().nullable(),
    rating: z.number().nullable(),
    reviews: int().nullable(),
    pricing: AppPricingSchema,
    built_for_shopify: z.boolean().nullable(),
    profile: z.enum(['full', 'basic']),
    usage: UsageStatSchema,
    cta: CtaSchema.nullable(),
  }),
);

export const ListAppsOutput = z.object({
  items: z.array(AppListItemSchema),
  facets: z.object({ categories: z.array(FacetSchema) }),
});

export const AppCategorySchema = named(
  'AppCategory',
  CategoryRefSchema.extend({
    app_count: int(),
    store_count: int().describe('Active scanned stores running at least one app in the category.'),
    share: z.number(),
    surfaces: z.array(SectionTypeRefSchema),
    top_apps: z.array(AppRefSchema),
    source: z.string(),
    as_of: z.string(),
  }),
);

export const ListAppCategoriesOutput = z.object({ items: z.array(AppCategorySchema) });

export const GetAppInput = z.object({
  slug: z.string(),
  stores_limit: int().min(0).max(60).default(24),
});

export const ListAppStoresInput = z.object({
  slug: z.string(),
  cursor: z.string().optional(),
  limit: int().min(1).max(100).default(48),
});

export const AppStoreRowSchema = named(
  'AppStoreRow',
  z.object({
    store: StoreRefSchema,
    theme: StoreThemeInfoSchema,
    app_count: int(),
    is_captured: z.boolean(),
    first_seen: z.string(),
  }),
);

export const PlanSchema = z.object({
  name: z.string(),
  price_label: z.string(),
  price_cents: int().nullable(),
  period: z.string().nullable(),
  trial_days: int().nullable(),
  features: z.array(z.string()),
});

export const AppFactsSchema = named(
  'AppFacts',
  AppListItemSchema.extend({
    app_store_handle: z.string().nullable(),
    app_store_url: z.string().nullable(),
    website_url: z.string().nullable(),
    app_store_category: z.string().nullable(),
    launched_on: z.string().nullable(),
    plans: z.array(PlanSchema),
    features: z.array(z.string()),
    works_with: z.array(z.string()),
    languages: z.array(z.string()),
    checked_on: z.string().nullable().describe('Day the App Store listing was read.'),
    facts_source: z.string().describe('Key into meta.sources for rating/reviews/pricing.'),
    aliases: z.array(z.string()).describe('Other slugs that redirect here.'),
  }),
);

export const AppDetailSchema = named(
  'AppDetail',
  z.object({
    app: AppFactsSchema,
    surfaces: z.array(SectionTypeRefSchema).describe('Where apps in this category usually render.'),
    seen_on: z.object({
      stores: z.array(
        z.object({
          store: StoreRefSchema,
          preview: ScreenshotThumbSchema.nullable(),
          sections: z.array(SectionCardSchema),
        }),
      ),
      sections: z.array(SectionCardSchema),
      section_total: int(),
    }),
    stores: pagedList(AppStoreRowSchema),
    co_installed: z
      .array(z.object({ app: AppRefSchema, stores: int(), share: z.number() }))
      .describe('share = of this app’s stores that also run the other app.'),
    alternatives: z.array(AppListItemSchema),
    comparisons: z.array(ComparisonLinkSchema),
    themes: z.array(z.object({ theme: ThemeRefSchema, stores: int(), share: z.number() })),
  }),
);

export type ListAppsInput = z.input<typeof ListAppsInput>;
export type AppPricing = z.infer<typeof AppPricingSchema>;
export type AppListItem = z.infer<typeof AppListItemSchema>;
export type ListAppsOutput = z.infer<typeof ListAppsOutput>;
export type AppCategory = z.infer<typeof AppCategorySchema>;
export type AppStoreRow = z.infer<typeof AppStoreRowSchema>;
export type AppPlan = z.infer<typeof PlanSchema>;
export type AppFacts = z.infer<typeof AppFactsSchema>;
export type AppDetail = z.infer<typeof AppDetailSchema>;
