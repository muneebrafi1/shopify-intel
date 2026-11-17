import { z } from 'zod';
import { PageInfoSchema, SourceSchema, named } from './common.ts';

export const ResponseMetaSchema = named(
  'ResponseMeta',
  z.object({
    api_version: z.literal('v1'),
    data_version: z.string().describe('Changes whenever the underlying data changes (ETag).'),
    data_as_of: z.string().describe('Date of the latest scan in the data (YYYY-MM-DD).'),
    sources: z.record(z.string(), SourceSchema),
    pagination: PageInfoSchema.optional(),
    canonical: z.string().optional().describe('Canonical site path for this resource.'),
  }),
);
export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;

export const ErrorCodeEnum = z.enum([
  'bad_request',
  'validation_error',
  'not_found',
  'method_not_allowed',
  'unsupported_media_type',
  'payload_too_large',
  'rate_limited',
  'unauthorized',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCodeEnum>;

export const ErrorResponseSchema = named(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: ErrorCodeEnum,
      message: z.string(),
      details: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .describe('Field-level validation problems.'),
    }),
  }),
);
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** The response envelope schema for a data schema. */
export const envelopeOf = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: ResponseMetaSchema });

export interface Envelope<T> {
  data: T;
  meta: ResponseMeta;
}
