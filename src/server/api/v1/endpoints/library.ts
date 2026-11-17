/** Sections library, screenshots, teardowns, comparisons and alternatives. */
import { z } from 'zod';
import { findApp } from '../../../repo/apps.ts';
import { comparisonLinks } from '../../../repo/comparisons.ts';
import { getAlternatives, getComparison, listAlternatives } from '../../../repo/compare.ts';
import {
  getScreenshot,
  getSectionDetail,
  listSectionTypes,
  listSections,
  listSectionsByApps,
} from '../../../repo/sections.ts';
import { getTeardown, listTeardowns } from '../../../repo/teardowns.ts';
import { findTheme } from '../../../repo/themes.ts';
import { defineEndpoint } from '../define.ts';
import { notFound } from '../errors.ts';
import { hrefs } from '../hrefs.ts';
import { ScreenshotDetailSchema } from '../schemas/common.ts';
import {
  AlternativesSchema,
  ComparisonDetailSchema,
  GetAlternativesInput,
  GetComparisonInput,
  ListAlternativesOutput,
  ListComparisonsInput,
  ListComparisonsOutput,
} from '../schemas/compare.ts';
import { GetTeardownInput, ListTeardownsOutput, TeardownDetailSchema } from '../schemas/misc.ts';
import {
  GetScreenshotInput,
  GetSectionInput,
  ListSectionTypesOutput,
  ListSectionsByAppsInput,
  ListSectionsByAppsOutput,
  ListSectionsInput,
  ListSectionsOutput,
  SectionDetailSchema,
} from '../schemas/sections.ts';

export const listSectionsEndpoint = defineEndpoint({
  id: 'listSections',
  method: 'GET',
  path: '/sections',
  summary: 'Browse sections',
  description:
    'Sliced page sections filtered by type, group, page type, device, theme, app or store, with facet counts per filter and cursor pagination.',
  tags: ['Sections'],
  cache: 'public',
  input: ListSectionsInput,
  output: ListSectionsOutput,
  handler: async (input, ctx) => {
    const r = await listSections(ctx, input);
    return {
      data: { items: r.items, facets: r.facets, section_type: r.section_type },
      pagination: r.pagination,
    };
  },
});

export const listSectionsByAppsEndpoint = defineEndpoint({
  id: 'listSectionsByApps',
  method: 'GET',
  path: '/sections-by-app',
  summary: 'Sections of several apps',
  description:
    'The first per_app sections of each app and its total, for up to 50 apps in one call: per app, the same items, order and total as listSections with app=<slug> and the same filters and sort. Apps come back in request order; unknown slugs are left out. For grids that show a few sections per app (one database query for the whole list).',
  tags: ['Sections'],
  cache: 'public',
  input: ListSectionsByAppsInput,
  output: ListSectionsByAppsOutput,
  handler: async (input, ctx) => ({ data: await listSectionsByApps(ctx, input) }),
});

export const listSectionTypesEndpoint = defineEndpoint({
  id: 'listSectionTypes',
  method: 'GET',
  path: '/section-types',
  summary: 'Section types with counts',
  tags: ['Sections'],
  cache: 'public',
  input: z.object({}),
  output: ListSectionTypesOutput,
  handler: async (_input, ctx) => ({ data: await listSectionTypes(ctx) }),
});

export const getSectionEndpoint = defineEndpoint({
  id: 'getSection',
  method: 'GET',
  path: '/sections/{id}',
  summary: 'Section detail',
  description: 'The section, the full screenshot with its other sections, and more like it.',
  tags: ['Sections'],
  cache: 'public',
  input: GetSectionInput,
  output: SectionDetailSchema,
  handler: async (input, ctx) => {
    const data = await getSectionDetail(ctx, input.id);
    return { data, canonical: data.section.href };
  },
});

export const getScreenshotEndpoint = defineEndpoint({
  id: 'getScreenshot',
  method: 'GET',
  path: '/screenshots/{id}',
  summary: 'Screenshot with all its sections',
  description: 'Used by viewers and by the placeholder renderer for planned captures.',
  tags: ['Sections'],
  cache: 'public',
  input: GetScreenshotInput,
  output: ScreenshotDetailSchema,
  handler: async (input, ctx) => ({ data: await getScreenshot(ctx, input.id) }),
});

export const listTeardownsEndpoint = defineEndpoint({
  id: 'listTeardowns',
  method: 'GET',
  path: '/teardowns',
  summary: 'Published teardowns',
  tags: ['Teardowns'],
  cache: 'public',
  input: z.object({}),
  output: ListTeardownsOutput,
  handler: async (_input, ctx) => ({ data: { items: await listTeardowns(ctx) } }),
});

export const getTeardownEndpoint = defineEndpoint({
  id: 'getTeardown',
  method: 'GET',
  path: '/teardowns/{slug}',
  summary: 'Teardown detail',
  description: 'The article, the embedded store detail, and notes resolved to sections.',
  tags: ['Teardowns'],
  cache: 'public',
  input: GetTeardownInput,
  output: TeardownDetailSchema,
  handler: async (input, ctx) => {
    const data = await getTeardown(ctx, input.slug);
    return { data, canonical: data.teardown.href };
  },
});

export const getComparisonEndpoint = defineEndpoint({
  id: 'getComparison',
  method: 'GET',
  path: '/compare/{pair}',
  summary: 'Compare two apps or two themes',
  description:
    'Curated popular pairs only (the ones listComparisons returns); any other pair is a 404 with details[0].message = "not_curated", so the site has no thin long-tail pages. When the pair is not in canonical (alphabetical) order, data.is_canonical is false and meta.canonical holds the path to 301 to.',
  tags: ['Compare'],
  cache: 'public',
  input: GetComparisonInput,
  output: ComparisonDetailSchema,
  handler: async (input, ctx) => {
    const data = await getComparison(ctx, input.pair);
    return { data, canonical: data.href };
  },
});

export const listComparisonsEndpoint = defineEndpoint({
  id: 'listComparisons',
  method: 'GET',
  path: '/comparisons',
  summary: 'Popular comparisons',
  tags: ['Compare'],
  cache: 'public',
  input: ListComparisonsInput,
  output: ListComparisonsOutput,
  handler: async (input, ctx) => {
    if (!input.slug) {
      return {
        data: { items: await comparisonLinks(ctx, { kind: input.kind, limit: input.limit }) },
      };
    }
    const app = input.kind === 'theme' ? null : await findApp(ctx, input.slug);
    const theme = app || input.kind === 'app' ? null : await findTheme(ctx, input.slug);
    if (!app && !theme) throw notFound(`'${input.slug}'`);
    const items = await comparisonLinks(ctx, {
      kind: app ? 'app' : 'theme',
      entityId: app?.id ?? theme?.id ?? 0,
      limit: input.limit,
    });
    return { data: { items } };
  },
});

export const getAlternativesEndpoint = defineEndpoint({
  id: 'getAlternatives',
  method: 'GET',
  path: '/alternatives/{slug}',
  summary: 'Alternatives to an app or theme',
  tags: ['Compare'],
  cache: 'public',
  input: GetAlternativesInput,
  output: AlternativesSchema,
  handler: async (input, ctx) => {
    const data = await getAlternatives(ctx, input.slug, input.kind);
    return { data, canonical: hrefs.alternatives(data.slug) };
  },
});

export const listAlternativesEndpoint = defineEndpoint({
  id: 'listAlternatives',
  method: 'GET',
  path: '/alternatives',
  summary: 'Apps and themes with alternatives pages',
  tags: ['Compare'],
  cache: 'public',
  input: z.object({}),
  output: ListAlternativesOutput,
  handler: async (_input, ctx) => ({ data: await listAlternatives(ctx) }),
});
