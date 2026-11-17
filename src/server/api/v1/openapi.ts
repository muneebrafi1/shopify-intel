/**
 * OpenAPI 3.1 documents generated from endpoint definitions (z.toJSONSchema). The public one is
 * served at /api/v1/openapi.json; named schemas (schemas/common.ts `named`) become components.
 * The admin namespace builds its own document from its own registry with the same generator
 * (`buildOpenApiDocument`), served only behind the admin guard, so nothing admin ever appears in
 * the public document.
 */
import { z } from 'zod';
import { SITE_NAME, SITE_URL } from '../../../config/site.ts';
import { pathParams, type EndpointDef } from './define.ts';
import { endpointList } from './registry.ts';
import { schemaRegistry } from './schemas/common.ts';
import { ErrorResponseSchema, ResponseMetaSchema, envelopeOf } from './schemas/envelope.ts';

export type Json = Record<string, unknown>;
export type SchemaRegistry = typeof schemaRegistry;

const strip = (schema: Json): Json => {
  const { $schema: _s, $id: _i, ...rest } = schema;
  return rest;
};

const responseId = (def: EndpointDef) =>
  `${def.id.charAt(0).toUpperCase()}${def.id.slice(1)}Response`;

function isOptional(field: z.ZodType): boolean {
  return field instanceof z.ZodOptional || field instanceof z.ZodDefault;
}

function parameters(def: EndpointDef): Json[] {
  const inPath = new Set(pathParams(def.path));
  const out: Json[] = [];
  for (const [name, raw] of Object.entries(def.input.shape)) {
    const field = raw as z.ZodType;
    const located = inPath.has(name) ? 'path' : 'query';
    if (def.method !== 'GET' && located === 'query') continue; // POST fields live in the body
    const schema = strip(z.toJSONSchema(field, { io: 'input', unrepresentable: 'any' }) as Json);
    const param: Json = {
      name,
      in: located,
      required: located === 'path' || !isOptional(field),
      schema,
    };
    if (typeof schema.description === 'string') param.description = schema.description;
    if (schema.type === 'array') Object.assign(param, { style: 'form', explode: false });
    out.push(param);
  }
  return out;
}

function operation(def: EndpointDef, basePath: string, extraErrors: readonly string[]): Json {
  const ok = String(def.successStatus ?? 200);
  const error = { $ref: '#/components/responses/Error' };
  const op: Json = {
    operationId: def.id,
    summary: def.summary,
    tags: def.tags,
    parameters: parameters(def),
    responses: {
      [ok]: {
        description: 'Success. `data` holds the result; `meta` carries provenance and pagination.',
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${responseId(def)}` } },
        },
      },
      ...(def.cache === 'public' ? { '304': { description: 'Not modified (ETag matched).' } } : {}),
      '400': error,
      ...Object.fromEntries(extraErrors.map((code) => [code, error])),
      '404': error,
      // Only the public POST (removal requests) is rate limited.
      ...(def.method === 'POST'
        ? { '415': error, ...(basePath === '/api/v1' ? { '429': error } : {}) }
        : {}),
      '500': error,
    },
  };
  if (def.description) op.description = def.description;
  if (def.method === 'POST') {
    const body = strip(z.toJSONSchema(def.input, { io: 'input', unrepresentable: 'any' }) as Json);
    op.requestBody = {
      required: true,
      content: {
        'application/json': { schema: body },
        'application/x-www-form-urlencoded': { schema: body },
      },
    };
  }
  return op;
}

export interface OpenApiOptions {
  endpoints: readonly EndpointDef[];
  /** Named schemas of this document (components). Response envelopes are added to it. */
  registry: SchemaRegistry;
  /** URL prefix of every path: '/api/v1' or '/api/v1/admin'. */
  basePath: string;
  title: string;
  description: string;
  /** Error statuses beyond 400/404/500 that every operation can return (e.g. 401, 403). */
  extraErrors?: readonly string[];
  /** OpenAPI securitySchemes + the document-wide security requirement. */
  security?: { schemes: Record<string, Json>; requirement: Array<Record<string, string[]>> };
}

/** Builds an OpenAPI 3.1 document for a set of endpoint definitions. */
export function buildOpenApiDocument(opts: OpenApiOptions): Json {
  const { registry, endpoints, basePath } = opts;
  for (const def of endpoints) {
    registry.add(envelopeOf(def.output), { id: responseId(def) });
  }
  if (!registry.has(ResponseMetaSchema)) registry.add(ResponseMetaSchema, { id: 'ResponseMeta' });
  if (!registry.has(ErrorResponseSchema))
    registry.add(ErrorResponseSchema, { id: 'ErrorResponse' });
  const generated = z.toJSONSchema(registry, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  }) as { schemas: Record<string, Json> };
  const schemas = Object.fromEntries(
    Object.entries(generated.schemas).map(([id, s]) => [id, strip(s)]),
  );

  const paths: Record<string, Json> = {};
  for (const def of endpoints) {
    const path = `${basePath}${def.path}`;
    paths[path] = {
      ...(paths[path] ?? {}),
      [def.method.toLowerCase()]: operation(def, basePath, opts.extraErrors ?? []),
    };
  }
  paths[`${basePath}/openapi.json`] = {
    get: {
      operationId: basePath === '/api/v1' ? 'openapi' : 'adminOpenapi',
      summary: 'This document',
      tags: ['Meta'],
      responses: { '200': { description: 'OpenAPI 3.1 document.' } },
    },
  };

  return {
    openapi: '3.1.0',
    info: { title: opts.title, version: '1.0.0', description: opts.description },
    servers: [{ url: SITE_URL }],
    tags: [...new Set(endpoints.flatMap((e) => e.tags))].map((name) => ({ name })),
    ...(opts.security ? { security: opts.security.requirement } : {}),
    paths,
    components: {
      schemas,
      responses: {
        Error: {
          description: 'Error envelope.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
      ...(opts.security ? { securitySchemes: opts.security.schemes } : {}),
    },
  };
}

let cached: Json | null = null;

/** The public document (/api/v1/openapi.json). Never includes the admin namespace. */
export function openApiDocument(): Json {
  cached ??= buildOpenApiDocument({
    endpoints: endpointList,
    registry: schemaRegistry,
    basePath: '/api/v1',
    title: `${SITE_NAME} API`,
    description:
      'Real Shopify stores, page by page: stores, themes, apps and the sections they render. Every count carries its source and date (see meta.sources). Public, read-only, CORS-open for GET.',
  });
  return cached;
}
