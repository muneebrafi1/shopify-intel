import type { ErrorCode } from './schemas/envelope.ts';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal_error: 500,
};

export interface ErrorDetail {
  path: string;
  message: string;
}

/** Thrown by handlers and the router; serialised as `{ error: { code, message } }`. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  readonly headers: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { details?: ErrorDetail[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = opts.details;
    this.headers = opts.headers ?? {};
  }
}

export const notFound = (what: string) => new ApiError('not_found', `${what} not found`);

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;

/** For pages: `const store = await orNotFound(api.getStore({ domain }))` → null on 404. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (isApiError(err) && err.code === 'not_found') return null;
    throw err;
  }
}
