/**
 * An endpoint is a typed definition: zod input + zod output + handler. The HTTP router, the
 * in-process client, the OpenAPI generator (and later the MCP server) are all derived from it.
 */
import type { z } from 'zod';
import type { Ctx } from './context.ts';
import type { PageInfo } from './schemas/common.ts';

export type HttpMethod = 'GET' | 'POST';

export interface HandlerResult<T> {
  data: T;
  pagination?: PageInfo;
  /** Canonical site path of the resource (e.g. after alias or pair-order resolution). */
  canonical?: string;
  /** Defaults to the endpoint's successStatus (200). */
  status?: number;
  headers?: Record<string, string>;
}

export interface EndpointDef<I extends z.ZodObject = z.ZodObject, O extends z.ZodType = z.ZodType> {
  /** operationId; also the in-process client method name and future MCP tool name. */
  id: string;
  method: HttpMethod;
  /** Path under /api/v1 with {param} placeholders, e.g. '/stores/{domain}'. */
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  /** Path params, query params (GET) and body fields (POST) in one object. */
  input: I;
  /** Schema of `data` in the response envelope. */
  output: O;
  /** 'public' responses are cacheable and CORS-open; 'no-store' ones are neither. */
  cache: 'public' | 'no-store';
  successStatus?: number;
  handler: (input: z.output<I>, ctx: Ctx) => Promise<HandlerResult<z.input<O>>>;
}

/** Identity helper that keeps the precise input/output types for the client. */
export function defineEndpoint<I extends z.ZodObject, O extends z.ZodType>(
  def: EndpointDef<I, O>,
): EndpointDef<I, O> {
  return def;
}

/** Path params of a template, e.g. '/stores/{domain}' → ['domain']. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] ?? '');
}
