/**
 * Runs one endpoint: validate input → build context → handler → (optionally) validate output →
 * envelope. Shared by the HTTP router and the in-process client so both behave identically.
 */
import { z } from 'zod';
import type { MediaStore } from '../../admin/actions.ts';
import type { Db } from '../../db/types.ts';
import { createNotifier, type Notifier, type WaitUntil } from '../../notify.ts';
import {
  dataInfoCache,
  type ApiEnv,
  type Ctx,
  type DataInfo,
  type RequestInfo,
} from './context.ts';
import type { EndpointDef } from './define.ts';
import { ApiError } from './errors.ts';
import type { Envelope, ResponseMeta } from './schemas/envelope.ts';

export interface ApiDeps {
  db: Db;
  env?: ApiEnv;
  now?: () => Date;
  /**
   * Validate every response against its schema. On in dev and tests; off in production by
   * default because it costs CPU on the Workers free plan (10 ms per request).
   */
  validateOutput?: boolean;
  /** Admin notifications. Defaults to a log-only notifier for env.ADMIN_NOTIFY_EMAIL. */
  notifier?: Notifier;
  /** Workers `waitUntil` (work after the response). Without it, background work is awaited. */
  waitUntil?: WaitUntil | null;
  /** R2 bucket (or a subset) for admin media deletion. */
  mediaStore?: MediaStore | null;
}

export interface Runtime {
  deps: ApiDeps;
  dataInfo: (db: Db, now: number) => Promise<DataInfo>;
  notifier: Notifier;
}

export function createRuntime(deps: ApiDeps): Runtime {
  return {
    deps,
    dataInfo: dataInfoCache(60_000),
    notifier: deps.notifier ?? createNotifier({ to: deps.env?.ADMIN_NOTIFY_EMAIL ?? null }),
  };
}

export interface Executed<T> {
  envelope: Envelope<T>;
  status: number;
  headers: Record<string, string>;
}

export function zodDetails(error: z.ZodError) {
  return error.issues.map((i) => ({
    path: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

export async function buildCtx(rt: Runtime, request: RequestInfo | null): Promise<Ctx> {
  const { deps } = rt;
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? {};
  return {
    db: deps.db,
    env,
    data: await rt.dataInfo(deps.db, now().getTime()),
    media: { baseUrl: env.MEDIA_BASE_URL ?? null },
    now,
    request,
    notifier: rt.notifier,
    waitUntil: deps.waitUntil ?? null,
    mediaStore: deps.mediaStore ?? null,
  };
}

export function metaFor(data: DataInfo): ResponseMeta {
  return {
    api_version: 'v1',
    data_version: data.dataVersion,
    data_as_of: data.dataAsOf,
    sources: data.sources,
  };
}

export async function execute<I extends z.ZodObject, O extends z.ZodType>(
  rt: Runtime,
  def: EndpointDef<I, O>,
  rawInput: unknown,
  request: RequestInfo | null,
): Promise<Executed<z.output<O>>> {
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new ApiError('validation_error', `Invalid input for ${def.id}`, {
      details: zodDetails(parsed.error),
    });
  }
  const ctx = await buildCtx(rt, request);
  const result = await def.handler(parsed.data, ctx);

  let data = result.data as z.output<O>;
  if (rt.deps.validateOutput) {
    const checked = def.output.safeParse(result.data);
    if (!checked.success) {
      throw new ApiError('internal_error', `Response of ${def.id} does not match its schema`, {
        details: zodDetails(checked.error),
      });
    }
    data = checked.data;
  }
  const meta = metaFor(ctx.data);
  if (result.pagination) meta.pagination = result.pagination;
  if (result.canonical) meta.canonical = result.canonical;
  return {
    envelope: { data, meta },
    status: result.status ?? def.successStatus ?? 200,
    headers: result.headers ?? {},
  };
}
