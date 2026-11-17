/**
 * In-process API client: the same endpoint definitions the HTTP router serves, called directly
 * (no HTTP hop, same validation, same envelope). Pages use the instance from `~/server/api`.
 *
 *   const { data, meta } = await api.getStore({ domain: 'youngla.com' });
 *
 * Errors are thrown as ApiError (`err.code === 'not_found'`, `err.status === 404`); see
 * `orNotFound()` in ./errors.ts for the common "404 → null" case.
 */
import type { z } from 'zod';
import type { RequestInfo } from './context.ts';
import type { EndpointDef } from './define.ts';
import { createRuntime, execute, type ApiDeps, type Runtime } from './execute.ts';
import { endpoints, type Endpoints } from './registry.ts';
import type { Envelope } from './schemas/envelope.ts';

export interface CallOptions {
  /** Pass the client IP for endpoints that rate-limit (e.g. createRemovalRequest from a form). */
  request?: RequestInfo;
}

type InputOf<E> = E extends EndpointDef<infer I, z.ZodType> ? z.input<I> : never;
type OutputOf<E> = E extends EndpointDef<z.ZodObject, infer O> ? z.output<O> : never;

type Method<E> =
  {} extends InputOf<E>
    ? (input?: InputOf<E>, opts?: CallOptions) => Promise<Envelope<OutputOf<E>>>
    : (input: InputOf<E>, opts?: CallOptions) => Promise<Envelope<OutputOf<E>>>;

export type ApiClient = { [K in keyof Endpoints]: Method<Endpoints[K]> };

/** `deps` may be a factory so bindings are read lazily (first call), not at import time. */
export function createApiClient(deps: ApiDeps | (() => ApiDeps)): ApiClient {
  let rt: Runtime | null = null;
  const runtime = () => (rt ??= createRuntime(typeof deps === 'function' ? deps() : deps));
  const client: Record<string, (input?: unknown, opts?: CallOptions) => Promise<unknown>> = {};
  for (const [key, def] of Object.entries(endpoints)) {
    client[key] = async (input, opts) =>
      (await execute(runtime(), def as EndpointDef, input ?? {}, opts?.request ?? null)).envelope;
  }
  return client as ApiClient;
}
