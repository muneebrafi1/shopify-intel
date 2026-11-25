/**
 * Schemas of the admin API (/api/v1/admin/*). They live in their own registry so the public
 * OpenAPI document (/api/v1/openapi.json) never lists them; the admin document is built from this
 * registry and served only behind the admin guard (/api/v1/admin/openapi.json).
 */
import { z } from 'zod';
import { scanInputSchema } from '../../repo/scans.ts';

export const adminSchemaRegistry = z.registry<{ id: string; description?: string }>();

/** Registers a schema as a named component of the admin OpenAPI document only. */
function adminNamed<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  adminSchemaRegistry.add(schema, description ? { id, description } : { id });
  return schema;
}

const int = () => z.number().int();
const id = int()
  .min(1)
  .max(2 ** 31);
const note = z.string().trim().max(2000);
const isHttpsUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
};
const httpsUrl = z.string().max(2000).refine(isHttpsUrl, 'Enter a full https:// URL.');
const page = int().min(1).max(100_000).default(1);

export const AdminPageInfoSchema = adminNamed(
  'AdminPageInfo',
  z.object({ page: int(), limit: int(), total: int(), pages: int() }),
);

/** Every mutation answers with the action's result key and its human message. */
export const ActionOutcomeSchema = adminNamed(
  'AdminActionOutcome',
  z.object({
    result: z.string().describe("Result key, e.g. 'saved', 'no_changes', 'removal_done'."),
    message: z.string(),
  }),
);

// ---------------------------------------------------------------------------------------------
// Removal requests
// ---------------------------------------------------------------------------------------------
export const RemovalStatusEnum = z.enum(['pending', 'approved', 'rejected', 'done']);
export const RemovalScopeEnum = z.enum(['store', 'screenshots', 'details']);

export const AdminRemovalRequestSchema = adminNamed(
  'AdminRemovalRequest',
  z.object({
    id: int(),
    reference: z.string(),
    domain: z.string(),
    email: z.string().describe('Requester email (personal data: kept 2 years after closing).'),
    name: z.string().nullable(),
    reason: z.string(),
    scope: RemovalScopeEnum,
    status: RemovalStatusEnum,
    admin_note: z.string().nullable(),
    created_at: z.string(),
    handled_at: z.string().nullable(),
    store: z
      .object({ domain: z.string(), name: z.string().nullable(), status: z.string() })
      .nullable()
      .describe('The store in our library with this domain, if any.'),
    capture_blocked: z.boolean().describe('Future captures of this domain are blocked.'),
    admin_href: z.string(),
  }),
);

export const ListRemovalRequestsInput = z.object({
  status: RemovalStatusEnum.optional().describe('Only requests with this status.'),
  page,
  limit: int().min(1).max(100).default(50),
});
export const ListRemovalRequestsOutput = z.object({
  items: z.array(AdminRemovalRequestSchema),
  page: AdminPageInfoSchema,
});

export const CaptureBlockSchema = adminNamed(
  'CaptureBlock',
  z.object({
    domain: z.string(),
    scope: z.enum(['store', 'screenshots']),
    reason: z.string().describe("'removal-request', or 'tombstone' for older opt-outs."),
    reference: z.string().nullable(),
    removal_request_id: int().nullable().describe('Null once the request record is purged.'),
    created_at: z.string(),
  }),
);

export const GetRemovalRequestInput = z.object({ id });
export const RemovalRequestDetailSchema = adminNamed(
  'AdminRemovalRequestDetail',
  z.object({
    request: AdminRemovalRequestSchema,
    capture_block: CaptureBlockSchema.nullable(),
    store_media: z
      .object({
        screenshots: int(),
        placeholders: int(),
        r2_objects: int(),
        sections: int(),
        teardowns_published: int(),
        queued_jobs: int(),
        tombstoned: z.boolean(),
      })
      .describe('What approving would retire or delete.'),
  }),
);

export const UpdateRemovalRequestInput = z.object({
  id,
  action: z
    .enum(['approve', 'reject', 'complete'])
    .describe(
      "approve: apply the request (scope 'store' or 'screenshots' also blocks future captures); reject: needs a note; complete: retry the media deletion of an approved request.",
    ),
  note: note.optional().describe('Admin note. Required to reject (3+ characters).'),
  confirm: z
    .boolean()
    .default(false)
    .describe('Must be true to approve (it hides the store or deletes images).'),
});
export const UpdateRemovalRequestOutput = ActionOutcomeSchema.extend({
  deleted_media: int().nullable().describe('R2 objects deleted by this call, when known.'),
  request: AdminRemovalRequestSchema,
});

export const PurgeRemovalRecordsInput = z.object({
  dry_run: z.boolean().default(false).describe('Count what would be purged; delete nothing.'),
});
export const PurgeRemovalRecordsOutput = adminNamed(
  'PurgeResult',
  z.object({
    purged: int(),
    cutoff: z.string().describe('Requests closed before this instant are expired.'),
    retention_days: int(),
    dry_run: z.boolean(),
  }),
);

// ---------------------------------------------------------------------------------------------
// Capture blocks and targets (the capture pipeline's contract)
// ---------------------------------------------------------------------------------------------
export const ListCaptureBlocksInput = z.object({ page, limit: int().min(1).max(500).default(100) });
export const ListCaptureBlocksOutput = z.object({
  items: z.array(CaptureBlockSchema),
  page: AdminPageInfoSchema,
});

export const GetCaptureStatusInput = z.object({ domain: z.string().min(3).max(253) });
export const CaptureStatusSchema = adminNamed(
  'CaptureStatus',
  z.object({
    domain: z.string(),
    blocked: z.boolean().describe('True: never capture this domain.'),
    block: CaptureBlockSchema.nullable(),
  }),
);

export const ListCaptureTargetsInput = z.object({
  scope: z
    .enum(['curated', 'all'])
    .default('curated')
    .describe('curated = stores with a capture plan; all = every active detected store.'),
  limit: int().min(1).max(500).default(100),
  cursor: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional()
    .describe('next_cursor from the previous page.'),
});
export const ListCaptureTargetsOutput = z.object({
  items: z.array(
    adminNamed(
      'CaptureTarget',
      z.object({
        domain: z.string(),
        url: z.string(),
        is_curated: z.boolean(),
        is_captured: z.boolean(),
      }),
    ),
  ),
  next_cursor: z.string().nullable(),
  total: int(),
});

// ---------------------------------------------------------------------------------------------
// Stores, jobs, catalogue, affiliates, teardowns (the existing admin actions)
// ---------------------------------------------------------------------------------------------
export const UpdateStoreInput = z.object({
  domain: z.string().min(3).max(253),
  name: z.string().trim().max(120).nullable().optional(),
  category: z.string().max(80).nullable().optional().describe('Store category slug.'),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullable()
    .optional(),
  status: z.enum(['active', 'hidden']).optional().describe('Opted-out stores keep their status.'),
  curated: z.boolean().optional(),
});
export const UpdateStoreOutput = ActionOutcomeSchema.extend({
  store: z.object({
    domain: z.string(),
    name: z.string().nullable(),
    category: z.string().nullable(),
    country: z.string().nullable(),
    status: z.string(),
    is_curated: z.boolean(),
    capture_blocked: z.boolean(),
  }),
});

export const QueueJobInput = z.object({
  domain: z.string().min(3).max(253),
  kind: z
    .enum(['detect', 'capture', 'rescan'])
    .describe('capture is refused for capture-blocked domains (409).'),
  priority: int().min(0).max(100).optional(),
});
export const CancelJobInput = z.object({ id });

export const UpdateThemeInput = z.object({
  slug: z.string().max(80),
  name: z.string().trim().min(1).max(120).optional(),
  price_label: z.string().trim().max(40).nullable().optional(),
  marketplace: z.string().trim().max(80).nullable().optional(),
  status: z.enum(['active', 'hidden']).optional(),
});

export const UpdateAppInput = z.object({
  slug: z.string().max(120),
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().max(80).nullable().optional().describe('App category slug.'),
  tagline: z.string().trim().max(300).nullable().optional(),
  status: z.enum(['active', 'hidden']).optional(),
});

export const AffiliateLinkSchema = adminNamed(
  'AdminAffiliateLink',
  z.object({
    id: int(),
    target_type: z.enum(['app', 'theme', 'vendor']),
    target_name: z.string(),
    target_slug: z.string().nullable(),
    program_id: int().nullable(),
    program_name: z.string().nullable(),
    url: z.string().describe('Public referral URL (data, not a secret).'),
    label: z.string().nullable(),
    active: z.boolean(),
    clicks_total: int(),
    clicks_30d: int(),
    updated_at: z.string(),
  }),
);
export const ListAffiliateLinksOutput = z.object({ items: z.array(AffiliateLinkSchema) });

export const CreateAffiliateLinkInput = z.object({
  target_type: z.enum(['app', 'theme', 'vendor']),
  target_slug: z.string().max(120).describe('App or theme slug, or vendor slug.'),
  url: httpsUrl,
  label: z.string().trim().max(80).nullable().optional(),
  program_id: int().nullable().optional(),
  active: z.boolean().default(true),
});
export const CreateAffiliateLinkOutput = ActionOutcomeSchema.extend({ id: int().nullable() });

export const UpdateAffiliateLinkInput = z.object({
  id,
  url: httpsUrl.optional(),
  label: z.string().trim().max(80).nullable().optional(),
  program_id: int().nullable().optional(),
  active: z.boolean().optional(),
});

export const UpdateAffiliateProgramInput = z.object({
  id,
  status: z
    .string()
    .regex(/^[a-z][a-z-]{1,30}$/)
    .describe("e.g. 'approved', 'pending', 'no-program'."),
});

export const SetTeardownPublishedInput = z.object({
  slug: z.string().max(120),
  published: z.boolean(),
});

export const ListAuditInput = z.object({
  limit: int().min(1).max(200).default(50),
  target_type: z.string().max(40).optional(),
  target_id: z.string().max(253).optional(),
  include_auth: z.boolean().default(false).describe('Include sign-in events.'),
});
export const ListAuditOutput = z.object({
  items: z.array(
    adminNamed(
      'AuditEntry',
      z.object({
        id: int(),
        actor: z.string(),
        action: z.string(),
        target_type: z.string().nullable(),
        target_id: z.string().nullable(),
        detail: z.unknown().nullable(),
        created_at: z.string(),
      }),
    ),
  ),
});

export const AdminIndexOutput = z.object({
  name: z.string(),
  openapi: z.string(),
  principal: z.object({ actor: z.string(), method: z.enum(['access', 'password', 'token']) }),
  endpoints: z.array(
    z.object({ id: z.string(), method: z.string(), path: z.string(), summary: z.string() }),
  ),
});

// ---------------------------------------------------------------------------------------------
// Scans (crawler ingest)
// ---------------------------------------------------------------------------------------------
export const IngestScansInput = z.object({
  /** One scan per request keeps a request well inside D1's 50-statement budget. */
  scans: z.array(adminNamed('ScanInput', scanInputSchema)).min(1).max(1),
  /** Rebuild derived counts after this scan (send false for all but the last of a batch). */
  rebuild: z.boolean().default(true),
});

export const IngestScansOutput = z.object({
  results: z.array(
    adminNamed(
      'ScanResult',
      z.object({
        domain: z.string(),
        status: z.enum(['ingested', 'not-shopify', 'opted-out', 'unknown-store']),
        scan_id: z.number().int().optional(),
        theme: z.enum(['unchanged', 'changed', 'new', 'none']).optional(),
        apps_added: z.number().int().optional(),
        apps_seen: z.number().int().optional(),
        unresolved: z.number().int().optional(),
        pixels_added: z.number().int().optional(),
      }),
    ),
  ),
});
