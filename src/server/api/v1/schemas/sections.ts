import { z } from 'zod';
import {
  DeviceEnum,
  FacetSchema,
  PageTypeEnum,
  ScreenshotDetailSchema,
  SectionCardSchema,
  SectionGroupEnum,
  SectionTypeEnum,
  int,
  named,
} from './common.ts';

export const ListSectionsInput = z.object({
  type: SectionTypeEnum.optional(),
  group: SectionGroupEnum.optional(),
  page_type: PageTypeEnum.optional(),
  device: DeviceEnum.optional(),
  theme: z.string().optional().describe('Theme slug.'),
  app: z.string().optional().describe('App slug.'),
  store: z.string().optional().describe('Store domain.'),
  cursor: z.string().optional(),
  limit: int().min(1).max(60).default(24),
});

export const SectionTypeInfoSchema = named(
  'SectionTypeInfo',
  z.object({
    slug: SectionTypeEnum,
    name: z.string(),
    description: z.string(),
    group: z.object({ slug: SectionGroupEnum, name: z.string() }),
    href: z.string(),
    count: int().describe('Current sections of this type on active stores.'),
    stores: int().describe('Distinct active stores with at least one section of this type.'),
    themes: int().describe('Distinct themes those sections were seen on.'),
    pages: z.array(PageTypeEnum).describe('Page types where it usually appears.'),
    app_categories: z.array(z.string()).describe('App categories that render this section.'),
    preview: SectionCardSchema.nullable(),
  }),
);

export const ListSectionsOutput = z.object({
  items: z.array(SectionCardSchema),
  facets: z.object({
    types: z.array(FacetSchema),
    groups: z.array(FacetSchema),
    page_types: z.array(FacetSchema),
    devices: z.array(FacetSchema),
    themes: z.array(FacetSchema),
    apps: z.array(FacetSchema),
  }),
  section_type: SectionTypeInfoSchema.nullable().describe('Set when filtering by one type.'),
});

export const ListSectionTypesOutput = z.object({
  items: z.array(SectionTypeInfoSchema),
  groups: z.array(z.object({ slug: SectionGroupEnum, name: z.string(), count: int() })),
});

export const GetSectionInput = z.object({ id: int().positive() });

const SectionLinkSchema = z.object({ id: int(), href: z.string() });

export const SectionDetailSchema = named(
  'SectionDetail',
  z.object({
    section: SectionCardSchema,
    screenshot: ScreenshotDetailSchema,
    more_like_this: z.array(SectionCardSchema),
    in_type: z
      .object({
        position: int().describe('1-based position among current sections of this type.'),
        total: int(),
        prev: SectionLinkSchema.nullable(),
        next: SectionLinkSchema.nullable(),
      })
      .describe('Where this section sits in its type (library order), with prev/next links.'),
  }),
);

export const GetScreenshotInput = z.object({ id: int().positive() });

export type ListSectionsInput = z.input<typeof ListSectionsInput>;
export type SectionTypeInfo = z.infer<typeof SectionTypeInfoSchema>;
export type ListSectionsOutput = z.infer<typeof ListSectionsOutput>;
export type ListSectionTypesOutput = z.infer<typeof ListSectionTypesOutput>;
export type SectionDetail = z.infer<typeof SectionDetailSchema>;
