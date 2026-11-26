/** Schemas for teardowns, search, meta/index and removal requests. */
import { z } from 'zod';
import {
  DeviceEnum,
  ImageSchema,
  PageTypeEnum,
  ScreenshotThumbSchema,
  SectionTypeRefSchema,
  ShotSectionSchema,
  SourceSchema,
  StoreRefSchema,
  ThemeRefSchema,
  int,
  named,
} from './common.ts';
import { StoreDetailSchema } from './stores.ts';

// ---------------------------------------------------------------------------------------------
// Teardowns
// ---------------------------------------------------------------------------------------------
export const TeardownListItemSchema = named(
  'TeardownListItem',
  z.object({
    slug: z.string(),
    href: z.string(),
    title: z.string(),
    dek: z.string().nullable(),
    published_at: z.string().nullable(),
    is_sample: z.boolean().describe('Format demo; label it in the UI.'),
    store: StoreRefSchema,
    theme: ThemeRefSchema.nullable(),
    cover: ScreenshotThumbSchema.nullable(),
    note_count: int(),
  }),
);

export const ListTeardownsOutput = z.object({ items: z.array(TeardownListItemSchema) });

export const GetTeardownInput = z.object({ slug: z.string() });

export const TeardownNoteSchema = named(
  'TeardownNote',
  z.object({
    n: int(),
    title: z.string(),
    body: z.string().describe('Markdown.'),
    page_type: PageTypeEnum,
    device: DeviceEnum,
    section_type: SectionTypeRefSchema,
    screenshot_id: int().nullable(),
    section: ShotSectionSchema.nullable(),
  }),
);

export const TeardownDetailSchema = named(
  'TeardownDetail',
  z.object({
    teardown: TeardownListItemSchema.extend({ body_md: z.string() }),
    store: StoreDetailSchema,
    notes: z.array(TeardownNoteSchema),
  }),
);

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------
export const SearchKindEnum = z.enum([
  'store',
  'theme',
  'app',
  'app-category',
  'section-type',
  'teardown',
  'vendor',
]);

export const SearchInput = z.object({
  q: z.string().max(100).default(''),
  kinds: z.array(SearchKindEnum).optional().describe('Comma-separated in query strings.'),
  limit: int().min(1).max(20).default(6).describe('Per kind.'),
});

export const SearchHitSchema = named(
  'SearchHit',
  z.object({
    kind: SearchKindEnum,
    ref: z.string(),
    title: z.string(),
    subtitle: z.string().nullable(),
    href: z.string(),
    icon_url: z.string().nullable(),
    thumbnail: ImageSchema.nullable(),
  }),
);

export const SearchOutput = z.object({
  q: z.string(),
  is_suggestion: z.boolean().describe('True when q was empty and these are popular picks.'),
  groups: z.array(
    z.object({ kind: SearchKindEnum, label: z.string(), items: z.array(SearchHitSchema) }),
  ),
});

// ---------------------------------------------------------------------------------------------
// Meta + index
// ---------------------------------------------------------------------------------------------
export const MetaOutput = named(
  'DataMeta',
  z.object({
    data_version: z.string(),
    data_as_of: z.string(),
    source: SourceSchema.extend({ id: z.string() }),
    rules_version: z.string().nullable(),
    app_store_checked: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
    theme_store_checked: z
      .string()
      .nullable()
      .describe('Latest date a theme’s Theme Store page was read (presets, features, reviews).'),
    crawl_last_at: z
      .string()
      .nullable()
      .describe('Latest storefront scan from our own crawl (source vitrine-crawl); null if none.'),
    counts: z.object({
      stores_scanned: int(),
      stores_curated: int(),
      stores_captured: int(),
      stores_with_capture_plan: int(),
      themes: int(),
      theme_names_detected: int(),
      apps: int(),
      apps_full: int(),
      apps_basic: int(),
      app_categories: int(),
      screenshots: int(),
      screenshots_captured: int(),
      screenshots_placeholder: int(),
      sections: int(),
      section_types: int(),
      teardowns: int(),
      comparisons: int(),
    }),
  }),
);

export const IndexOutput = z.object({
  name: z.string(),
  version: z.literal('v1'),
  openapi: z.string(),
  endpoints: z.array(
    z.object({ id: z.string(), method: z.string(), path: z.string(), summary: z.string() }),
  ),
});

// ---------------------------------------------------------------------------------------------
// Removal requests
// ---------------------------------------------------------------------------------------------
export const RemovalScopeEnum = z.enum(['store', 'screenshots', 'details']);

export const CreateRemovalRequestInput = z.object({
  domain: z.string().min(3).max(253).describe('Store domain or URL.'),
  email: z.email().max(254),
  name: z.string().max(120).optional(),
  reason: z.string().trim().min(10).max(2000),
  scope: RemovalScopeEnum.default('store').describe(
    'store = remove the store everywhere; screenshots = images only; details = correct or remove specific details.',
  ),
  website: z.string().max(200).optional().describe('Honeypot. Leave empty.'),
});

export const RemovalRequestReceiptSchema = named(
  'RemovalRequestReceipt',
  z.object({
    reference: z.string(),
    status: z.literal('pending'),
    domain: z.string(),
    scope: RemovalScopeEnum,
    received_at: z.string(),
  }),
);

export type TeardownListItem = z.infer<typeof TeardownListItemSchema>;
export type TeardownNote = z.infer<typeof TeardownNoteSchema>;
export type TeardownDetail = z.infer<typeof TeardownDetailSchema>;
export type SearchKind = z.infer<typeof SearchKindEnum>;
export type SearchInput = z.input<typeof SearchInput>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchOutput = z.infer<typeof SearchOutput>;
export type DataMeta = z.infer<typeof MetaOutput>;
export type ApiIndex = z.infer<typeof IndexOutput>;
export type RemovalScope = z.infer<typeof RemovalScopeEnum>;
export type CreateRemovalRequestInput = z.input<typeof CreateRemovalRequestInput>;
export type RemovalRequestReceipt = z.infer<typeof RemovalRequestReceiptSchema>;
