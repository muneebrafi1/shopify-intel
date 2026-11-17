/** Data meta, search and the public removal-request form. */
import { getDataMeta } from '../../../repo/meta.ts';
import { createRemovalRequest } from '../../../repo/removal.ts';
import { search } from '../../../repo/search.ts';
import { defineEndpoint } from '../define.ts';
import {
  CreateRemovalRequestInput,
  MetaOutput,
  RemovalRequestReceiptSchema,
  SearchInput,
  SearchOutput,
} from '../schemas/misc.ts';
import { z } from 'zod';

export const getMetaEndpoint = defineEndpoint({
  id: 'getMeta',
  method: 'GET',
  path: '/meta',
  summary: 'Data provenance and headline counts',
  tags: ['Meta'],
  cache: 'public',
  input: z.object({}),
  output: MetaOutput,
  handler: async (_input, ctx) => ({ data: await getDataMeta(ctx) }),
});

export const searchEndpoint = defineEndpoint({
  id: 'search',
  method: 'GET',
  path: '/search',
  summary: 'Instant search',
  description:
    'Prefix search on every word across stores, themes, apps, categories, section types, teardowns and vendors, grouped by kind. Empty q returns popular suggestions.',
  tags: ['Search'],
  cache: 'public',
  input: SearchInput,
  output: SearchOutput,
  handler: async (input, ctx) => ({ data: await search(ctx, input) }),
});

export const createRemovalRequestEndpoint = defineEndpoint({
  id: 'createRemovalRequest',
  method: 'POST',
  path: '/removal-requests',
  summary: 'Ask for a store to be removed',
  description:
    'JSON or form-encoded. Rate limited per (hashed) IP and per domain. Returns a reference to quote in follow-ups.',
  tags: ['Removal'],
  cache: 'no-store',
  successStatus: 201,
  input: CreateRemovalRequestInput,
  output: RemovalRequestReceiptSchema,
  handler: async (input, ctx) => {
    const { receipt } = await createRemovalRequest(ctx, input);
    return { data: receipt };
  },
});
