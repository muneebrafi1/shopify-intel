/** Stores, themes and apps. */
import { z } from 'zod';
import {
  getAppDetail,
  appStores,
  findApp,
  listAppCategories,
  listApps,
} from '../../../repo/apps.ts';
import { getStoreDetail, listStores } from '../../../repo/stores.ts';
import { findTheme, getThemeDetail, listThemes, themeStores } from '../../../repo/themes.ts';
import { appRef, themeRef } from '../../../repo/refs.ts';
import { defineEndpoint } from '../define.ts';
import { notFound } from '../errors.ts';
import { hrefs } from '../hrefs.ts';
import {
  AppDetailSchema,
  AppStoreRowSchema,
  GetAppInput,
  ListAppCategoriesOutput,
  ListAppStoresInput,
  ListAppsInput,
  ListAppsOutput,
} from '../schemas/apps.ts';
import { AppRefSchema, ThemeRefSchema } from '../schemas/common.ts';
import {
  GetStoreInput,
  ListStoresInput,
  ListStoresOutput,
  StoreDetailSchema,
} from '../schemas/stores.ts';
import {
  GetThemeInput,
  ListThemeStoresInput,
  ListThemesInput,
  ListThemesOutput,
  ThemeDetailSchema,
  ThemeStoreRowSchema,
} from '../schemas/themes.ts';

export const listStoresEndpoint = defineEndpoint({
  id: 'listStores',
  method: 'GET',
  path: '/stores',
  summary: 'List stores',
  description:
    'Stores with filters, facet counts (each facet ignores its own filter) and keyset pagination. Defaults to the curated stores (scope=curated), with or without filters; scope=all lists every detected store. facets.scope counts both.',
  tags: ['Stores'],
  cache: 'public',
  input: ListStoresInput,
  output: ListStoresOutput,
  handler: async (input, ctx) => {
    const r = await listStores(ctx, input);
    return { data: { items: r.items, facets: r.facets }, pagination: r.pagination };
  },
});

export const getStoreEndpoint = defineEndpoint({
  id: 'getStore',
  method: 'GET',
  path: '/stores/{domain}',
  summary: 'Store detail',
  description:
    'Theme (with history), apps grouped by category, pixels, pages with desktop/mobile screenshots and their sections, similar stores and detection provenance.',
  tags: ['Stores'],
  cache: 'public',
  input: GetStoreInput,
  output: StoreDetailSchema,
  handler: async (input, ctx) => {
    const data = await getStoreDetail(ctx, input.domain);
    return { data, canonical: hrefs.store(data.store.domain) };
  },
});

export const listThemesEndpoint = defineEndpoint({
  id: 'listThemes',
  method: 'GET',
  path: '/themes',
  summary: 'List themes',
  tags: ['Themes'],
  cache: 'public',
  input: ListThemesInput,
  output: ListThemesOutput,
  handler: async (input, ctx) => {
    const r = await listThemes(ctx, input);
    return { data: { items: r.items, facets: r.facets }, pagination: r.pagination };
  },
});

export const getThemeEndpoint = defineEndpoint({
  id: 'getTheme',
  method: 'GET',
  path: '/themes/{slug}',
  summary: 'Theme detail',
  description:
    'Facts, CTA, versions seen, curated stores with screenshots, the first page of stores using it, apps most used with it, sections, similar themes.',
  tags: ['Themes'],
  cache: 'public',
  input: GetThemeInput,
  output: ThemeDetailSchema,
  handler: async (input, ctx) => {
    const data = await getThemeDetail(ctx, input.slug, { storesLimit: input.stores_limit });
    return { data, canonical: hrefs.theme(data.theme.slug) };
  },
});

export const listThemeStoresEndpoint = defineEndpoint({
  id: 'listThemeStores',
  method: 'GET',
  path: '/themes/{slug}/stores',
  summary: 'Stores using a theme',
  tags: ['Themes'],
  cache: 'public',
  input: ListThemeStoresInput,
  output: z.object({ theme: ThemeRefSchema, items: z.array(ThemeStoreRowSchema) }),
  handler: async (input, ctx) => {
    const theme = await findTheme(ctx, input.slug);
    if (!theme) throw notFound(`Theme '${input.slug}'`);
    const page = await themeStores(ctx, theme.id, input.limit, input.cursor);
    return {
      data: { theme: themeRef(theme), items: page.items },
      pagination: { limit: input.limit, next_cursor: page.next_cursor, total: page.total },
    };
  },
});

export const listAppsEndpoint = defineEndpoint({
  id: 'listApps',
  method: 'GET',
  path: '/apps',
  summary: 'List apps',
  tags: ['Apps'],
  cache: 'public',
  input: ListAppsInput,
  output: ListAppsOutput,
  handler: async (input, ctx) => {
    const r = await listApps(ctx, input);
    return { data: { items: r.items, facets: r.facets }, pagination: r.pagination };
  },
});

export const listAppCategoriesEndpoint = defineEndpoint({
  id: 'listAppCategories',
  method: 'GET',
  path: '/app-categories',
  summary: 'App categories with counts',
  tags: ['Apps'],
  cache: 'public',
  input: z.object({}),
  output: ListAppCategoriesOutput,
  handler: async (_input, ctx) => ({ data: { items: await listAppCategories(ctx) } }),
});

export const getAppEndpoint = defineEndpoint({
  id: 'getApp',
  method: 'GET',
  path: '/apps/{slug}',
  summary: 'App detail',
  description:
    'App Store facts (with checked date), where the app shows up on real stores, stores running it, co-installed apps, alternatives, comparisons and the themes its stores use. Alias slugs resolve to the canonical app (see meta.canonical).',
  tags: ['Apps'],
  cache: 'public',
  input: GetAppInput,
  output: AppDetailSchema,
  handler: async (input, ctx) => {
    const data = await getAppDetail(ctx, input.slug, { storesLimit: input.stores_limit });
    return { data, canonical: hrefs.app(data.app.slug) };
  },
});

export const listAppStoresEndpoint = defineEndpoint({
  id: 'listAppStores',
  method: 'GET',
  path: '/apps/{slug}/stores',
  summary: 'Stores running an app',
  tags: ['Apps'],
  cache: 'public',
  input: ListAppStoresInput,
  output: z.object({ app: AppRefSchema, items: z.array(AppStoreRowSchema) }),
  handler: async (input, ctx) => {
    const app = await findApp(ctx, input.slug);
    if (!app) throw notFound(`App '${input.slug}'`);
    const page = await appStores(ctx, app.id, input.limit, input.cursor);
    return {
      data: { app: appRef(app), items: page.items },
      pagination: { limit: input.limit, next_cursor: page.next_cursor, total: page.total },
    };
  },
});
