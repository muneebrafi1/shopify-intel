/**
 * OpenAPI 3.1 document generated from the endpoint definitions (z.toJSONSchema). Served at
 * /api/v1/openapi.json. Named schemas (see schemas/common.ts `named`) become components.
 */
import { z } from 'zod';
import { SITE_NAME, SITE_URL } from '../../../config/site.ts';
import { pathParams, type EndpointDef } from './define.ts';
import { endpointList } from './registry.ts';
import { schemaRegistry } from './schemas/common.ts';
import { ErrorResponseSchema, envelopeOf } from './schemas/envelope.ts';

type Json = Record<string, unknown>;

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

function operation(def: EndpointDef): Json {
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
      '404': error,
      ...(def.method === 'POST' ? { '415': error, '429': error } : {}),
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

let cached: Json | null = null;

export function openApiDocument(): Json {
  if (cached) return cached;
  for (const def of endpointList) {
    schemaRegistry.add(envelopeOf(def.output), { id: responseId(def) });
  }
  if (!schemaRegistry.has(ErrorResponseSchema))
    schemaRegistry.add(ErrorResponseSchema, { id: 'ErrorResponse' });
  const generated = z.toJSONSchema(schemaRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  }) as { schemas: Record<string, Json> };
  const schemas = Object.fromEntries(
    Object.entries(generated.schemas).map(([id, s]) => [id, strip(s)]),
  );

  const paths: Record<string, Json> = {};
  for (const def of endpointList) {
    const path = `/api/v1${def.path}`;
    paths[path] = { ...(paths[path] ?? {}), [def.method.toLowerCase()]: operation(def) };
  }
  paths['/api/v1/openapi.json'] = {
    get: {
      operationId: 'openapi',
      summary: 'This document',
      tags: ['Meta'],
      responses: { '200': { description: 'OpenAPI 3.1 document.' } },
    },
  };

  cached = {
    openapi: '3.1.0',
    info: {
      title: `${SITE_NAME} API`,
      version: '1.0.0',
      description:
        'Real Shopify stores, page by page: stores, themes, apps and the sections they render. Every count carries its source and date (see meta.sources). Public, read-only, CORS-open for GET.',
    },
    servers: [{ url: SITE_URL }],
    tags: [...new Set(endpointList.flatMap((e) => e.tags))].map((name) => ({ name })),
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
    },
  };
  return cached;
}
