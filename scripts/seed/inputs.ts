/// <reference types="node" />
/**
 * Typed, validated loading of the seed inputs in data/seed and data/curation.
 * Validation catches shape drift in exports early (the seed is the contract with the crawler).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const nullableString = z.string().nullable();

const AffiliateRef = z.object({ url: z.string(), program: z.string().optional() }).nullable();

const PlanInput = z.object({
  name: z.string(),
  price: z.string(),
  period: z.string().nullable().optional(),
  trial_days: z.number().nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
});

export const AppInput = z.object({
  slug: z.string(),
  app_store_handle: nullableString,
  name: z.string(),
  developer: nullableString,
  category: z.string(),
  tagline: nullableString,
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
  icon_url: nullableString,
  app_store_url: nullableString,
  launched: nullableString.optional(),
  built_for_shopify: z.boolean().nullable().optional(),
  app_store_category: nullableString.optional(),
  plans: z.array(PlanInput).nullable().optional(),
  free_plan: z.boolean().nullable().optional(),
  from_price: z.number().nullable().optional(),
  trial_days: z.number().nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
  works_with: z.array(z.string()).nullable().optional(),
  languages: z.array(z.string()).nullable().optional(),
  app_store_checked_on: nullableString.optional(),
  scan: z.object({
    stores: z.number(),
    pct_of_scanned: z.number().optional(),
    co_installed: z.array(z.string()).optional(),
  }),
  affiliate: AffiliateRef,
});
export type AppInput = z.infer<typeof AppInput>;

export const ThemeInput = z.object({
  slug: z.string(),
  name: z.string(),
  vendor: nullableString,
  theme_store_id: z.number().nullable(),
  price: nullableString,
  marketplace: nullableString,
  official_url: nullableString,
  affiliate: AffiliateRef,
  scan: z.object({ stores: z.number() }),
});
export type ThemeInput = z.infer<typeof ThemeInput>;

export const CuratedStoreInput = z.object({
  domain: z.string(),
  url: nullableString,
  theme: z
    .object({
      slug: nullableString,
      name: nullableString,
      version: nullableString,
      raw_name: nullableString,
    })
    .nullable(),
  apps: z.array(z.object({ slug: z.string(), confidence: z.number().nullable() })),
  pixels: z.array(z.string()).nullable(),
  currency: nullableString,
  tranco_rank: z.number().nullable(),
  detected_at: z.string(),
  source: z.string(),
});
export type CuratedStoreInput = z.infer<typeof CuratedStoreInput>;

export const DetectionInput = z.object({
  domain: z.string(),
  theme: nullableString,
  theme_custom: z.boolean(),
  apps: z.array(z.string()),
  currency: nullableString,
  detected_at: z.string(),
});
export type DetectionInput = z.infer<typeof DetectionInput>;

export const AffiliateProgramInput = z.object({
  program: z.string(),
  network: nullableString,
  status: z.string(),
});
export type AffiliateProgramInput = z.infer<typeof AffiliateProgramInput>;

export const AffiliateLinkInput = z.object({
  target_type: z.enum(['app', 'theme', 'vendor']),
  target_slug: z.string().optional(),
  target_name: z.string().optional(),
  url: z.url(),
  program: nullableString,
});
export type AffiliateLinkInput = z.infer<typeof AffiliateLinkInput>;

export const StoreCurationInput = z.object({
  _note: z.string(),
  stores: z.array(
    z.object({
      domain: z.string(),
      name: nullableString,
      category: nullableString,
      country: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .nullable(),
    }),
  ),
});
export type StoreCurationInput = z.infer<typeof StoreCurationInput>;

export const AppCurationInput = z.object({
  _note: z.string(),
  short_names: z.record(z.string(), z.string().min(2)),
});
export type AppCurationInput = z.infer<typeof AppCurationInput>;

/**
 * data/curation/overrides.json: corrections applied on top of the raw exports (which are
 * re-exported and never edited by hand). Optional; a missing file means no overrides.
 */
export const OverridesInput = z.object({
  _note: z.string(),
  unmatchDetectionSlugs: z
    .array(z.object({ slug: z.string().min(1), reason: z.string().min(3) }))
    .default([]),
  dropAffiliateLinks: z
    .array(
      z.object({
        target_type: z.enum(['app', 'theme', 'vendor']),
        target_slug: z.string().min(1),
        reason: z.string().min(3),
      }),
    )
    .default([]),
});
export type OverridesInput = z.infer<typeof OverridesInput>;

const NO_OVERRIDES: OverridesInput = {
  _note: 'none',
  unmatchDetectionSlugs: [],
  dropAffiliateLinks: [],
};

export interface TeardownFile {
  file: string;
  source: string;
}

export interface SeedInputs {
  apps: AppInput[];
  appsExtra: AppInput[];
  themes: ThemeInput[];
  curatedStores: CuratedStoreInput[];
  detections: DetectionInput[];
  programs: AffiliateProgramInput[];
  links: AffiliateLinkInput[];
  categories: string[];
  storeCuration: StoreCurationInput;
  appCuration: AppCurationInput;
  overrides: OverridesInput;
  teardowns: TeardownFile[];
  /** Raw bytes of every input, for the data_version hash. */
  rawFiles: Array<{ name: string; content: string }>;
}

export function loadSeedInputs(root: string): SeedInputs {
  const rawFiles: SeedInputs['rawFiles'] = [];
  const read = (rel: string): string => {
    const content = readFileSync(join(root, rel), 'utf8');
    rawFiles.push({ name: rel, content });
    return content;
  };
  const json = <T>(rel: string, schema: z.ZodType<T>): T => {
    const parsed = schema.safeParse(JSON.parse(read(rel)));
    if (!parsed.success) {
      throw new Error(`Invalid seed input ${rel}:\n${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
  };

  const teardownDir = join(root, 'data/curation/teardowns');
  const teardowns: TeardownFile[] = existsSync(teardownDir)
    ? readdirSync(teardownDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => ({ file: f, source: read(`data/curation/teardowns/${f}`) }))
    : [];

  return {
    apps: json('data/seed/apps.json', z.array(AppInput)),
    appsExtra: json('data/seed/apps-extra.json', z.array(AppInput)),
    themes: json('data/seed/themes.json', z.array(ThemeInput)),
    curatedStores: json('data/seed/stores.json', z.array(CuratedStoreInput)),
    detections: json('data/seed/detections-930.json', z.array(DetectionInput)),
    programs: json('data/seed/affiliate-programs.json', z.array(AffiliateProgramInput)),
    links: json('data/seed/affiliate-links.json', z.array(AffiliateLinkInput)),
    categories: json('data/seed/categories.json', z.array(z.string())),
    storeCuration: json('data/curation/stores.json', StoreCurationInput),
    appCuration: json('data/curation/apps.json', AppCurationInput),
    overrides: existsSync(join(root, 'data/curation/overrides.json'))
      ? json('data/curation/overrides.json', OverridesInput)
      : NO_OVERRIDES,
    teardowns,
    rawFiles,
  };
}
