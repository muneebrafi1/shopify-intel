/**
 * Every public v1 endpoint, keyed by operationId. The key is the in-process client method name.
 * Adding an endpoint here exposes it over HTTP, in the client and in the OpenAPI document.
 */
import { z } from 'zod';
import { SITE_NAME } from '../../../config/site.ts';
import { defineEndpoint, type EndpointDef } from './define.ts';
import * as catalog from './endpoints/catalog.ts';
import * as library from './endpoints/library.ts';
import * as site from './endpoints/site.ts';
import { IndexOutput } from './schemas/misc.ts';

const rest = {
  getMeta: site.getMetaEndpoint,
  search: site.searchEndpoint,
  listStores: catalog.listStoresEndpoint,
  getStore: catalog.getStoreEndpoint,
  listThemes: catalog.listThemesEndpoint,
  getTheme: catalog.getThemeEndpoint,
  listThemeStores: catalog.listThemeStoresEndpoint,
  listApps: catalog.listAppsEndpoint,
  listAppCategories: catalog.listAppCategoriesEndpoint,
  getApp: catalog.getAppEndpoint,
  listAppStores: catalog.listAppStoresEndpoint,
  listSections: library.listSectionsEndpoint,
  listSectionsByApps: library.listSectionsByAppsEndpoint,
  listSectionTypes: library.listSectionTypesEndpoint,
  getSection: library.getSectionEndpoint,
  getScreenshot: library.getScreenshotEndpoint,
  listTeardowns: library.listTeardownsEndpoint,
  getTeardown: library.getTeardownEndpoint,
  getComparison: library.getComparisonEndpoint,
  listComparisons: library.listComparisonsEndpoint,
  getAlternatives: library.getAlternativesEndpoint,
  listAlternatives: library.listAlternativesEndpoint,
  createRemovalRequest: site.createRemovalRequestEndpoint,
};

const indexEndpoint = defineEndpoint({
  id: 'index',
  method: 'GET',
  path: '',
  summary: 'API index',
  tags: ['Meta'],
  cache: 'public',
  input: z.object({}),
  output: IndexOutput,
  handler: async () => ({
    data: {
      name: `${SITE_NAME} API`,
      version: 'v1' as const,
      openapi: '/api/v1/openapi.json',
      endpoints: [
        { id: 'index', method: 'GET', path: '/api/v1', summary: 'API index' },
        ...Object.values(rest).map((e) => ({
          id: e.id,
          method: e.method,
          path: `/api/v1${e.path}`,
          summary: e.summary,
        })),
        {
          id: 'openapi',
          method: 'GET',
          path: '/api/v1/openapi.json',
          summary: 'OpenAPI 3.1 document',
        },
      ],
    },
  }),
});

export const endpoints = { index: indexEndpoint, ...rest };
export type Endpoints = typeof endpoints;
export type EndpointId = keyof Endpoints;

/** Same list without the precise per-key types (for the router and OpenAPI generator). */
export const endpointList: readonly EndpointDef[] = Object.values(
  endpoints,
) as readonly EndpointDef[];

for (const [key, def] of Object.entries(endpoints)) {
  if (key !== def.id) throw new Error(`Endpoint key ${key} does not match its id ${def.id}`);
}
