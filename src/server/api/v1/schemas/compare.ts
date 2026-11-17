import { z } from 'zod';
import {
  AppRefSchema,
  CategoryRefSchema,
  ComparisonLinkSchema,
  StoreRefSchema,
  int,
  named,
} from './common.ts';
import { AppDetailSchema, AppListItemSchema } from './apps.ts';
import { ThemeDetailSchema, ThemeListItemSchema } from './themes.ts';

export const GetComparisonInput = z.object({
  pair: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]*-vs-[a-z0-9][a-z0-9.-]*$/)
    .describe(
      "'<a>-vs-<b>': two app slugs or two theme slugs. Only curated popular pairs (listComparisons) have a page; others 404.",
    ),
});

const CellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const MatrixRowSchema = named(
  'ComparisonRow',
  z.object({
    key: z.string(),
    label: z.string(),
    a: CellValue,
    b: CellValue,
    a_display: z.string(),
    b_display: z.string(),
    better: z
      .enum(['higher', 'lower'])
      .nullable()
      .describe('Direction that is objectively better.'),
    winner: z.enum(['a', 'b', 'tie']).nullable(),
    source: z.string().describe('Key into meta.sources.'),
  }),
);

export const ComparisonDetailSchema = named(
  'ComparisonDetail',
  z.object({
    kind: z.enum(['app', 'theme']),
    slug: z.string(),
    canonical_slug: z.string(),
    is_canonical: z.boolean().describe('False when a/b were requested in non-canonical order.'),
    href: z
      .string()
      .describe('Canonical page path; redirect (301) there when is_canonical is false.'),
    title: z.string(),
    apps: z.object({ a: AppDetailSchema, b: AppDetailSchema }).nullable(),
    themes: z.object({ a: ThemeDetailSchema, b: ThemeDetailSchema }).nullable(),
    shared_stores: z.object({ total: int(), items: z.array(StoreRefSchema) }),
    shared_apps: z
      .array(z.object({ app: AppRefSchema, a_stores: int(), b_stores: int() }))
      .describe('Themes only: apps popular on both themes.'),
    matrix: z.array(MatrixRowSchema),
    related: z.array(ComparisonLinkSchema),
  }),
);

export const ListComparisonsInput = z.object({
  kind: z.enum(['app', 'theme']).optional(),
  slug: z.string().optional().describe('Only comparisons involving this app/theme slug.'),
  limit: int().min(1).max(200).default(100),
});

export const ListComparisonsOutput = z.object({ items: z.array(ComparisonLinkSchema) });

export const GetAlternativesInput = z.object({
  slug: z.string(),
  kind: z
    .enum(['app', 'theme'])
    .optional()
    .describe('Disambiguates when an app and theme share a slug.'),
});

export const AlternativesSchema = named(
  'Alternatives',
  z.object({
    kind: z.enum(['app', 'theme']),
    slug: z.string(),
    title: z.string(),
    app: AppListItemSchema.nullable(),
    theme: ThemeListItemSchema.nullable(),
    category: CategoryRefSchema.nullable(),
    items: z.array(
      z.object({
        app: AppListItemSchema.nullable(),
        theme: ThemeListItemSchema.nullable(),
        shared_stores: int().describe('Stores running both (apps) or 0 (themes).'),
        compare_href: z
          .string()
          .describe('Canonical /compare path of the pair. Link it only when compare_available.'),
        compare_available: z
          .boolean()
          .describe(
            'True when the pair is a curated comparison with a page; other pairs 404 (no thin pages).',
          ),
        reasons: z.array(z.string()),
      }),
    ),
    comparisons: z.array(ComparisonLinkSchema),
  }),
);

export const ListAlternativesOutput = z.object({
  apps: z.array(
    z.object({
      app: AppRefSchema,
      href: z.string(),
      alternatives: int(),
      stores: int(),
    }),
  ),
  themes: z.array(
    z.object({
      theme: z.object({ slug: z.string(), name: z.string(), href: z.string() }),
      href: z.string(),
      alternatives: int(),
      stores: int(),
    }),
  ),
});

export type MatrixRow = z.infer<typeof MatrixRowSchema>;
export type ComparisonDetail = z.infer<typeof ComparisonDetailSchema>;
export type ListComparisonsOutput = z.infer<typeof ListComparisonsOutput>;
export type Alternatives = z.infer<typeof AlternativesSchema>;
export type ListAlternativesOutput = z.infer<typeof ListAlternativesOutput>;
