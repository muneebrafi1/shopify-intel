/**
 * Admin API endpoints (/api/v1/admin/*): the same typed definition pattern as the public API
 * (zod in → handler → zod out), mounted behind the admin guard (./mount.ts). Every handler maps
 * onto an existing admin action (src/server/admin/actions.ts) or query (queries.ts); every
 * mutation goes through an action, which writes the audit log with the caller as the actor.
 *
 * Errors: 400 validation, 401/403 auth (from the guard), 404 unknown record, 409 conflict
 * (already handled, already queued, capture blocked, …), 500 when media deletion failed after an
 * approval (retry with action=complete).
 */
import { z } from 'zod';
import { SITE_NAME } from '../../../config/site.ts';
import type { Ctx, Principal } from '../../api/v1/context.ts';
import { defineEndpoint, type EndpointDef } from '../../api/v1/define.ts';
import { ApiError } from '../../api/v1/errors.ts';
import type { ErrorCode } from '../../api/v1/schemas/envelope.ts';
import { normalizeDomain } from '../../lib/slug.ts';
import {
  captureBlockFor,
  isCaptureBlocked,
  listCaptureBlocks,
  listCaptureTargets,
} from '../../repo/capture.ts';
import { rebuildDerived } from '../../repo/maintenance.ts';
import { purgeExpiredRemovalRecords } from '../../repo/removal.ts';
import { ingestScan } from '../../repo/scans.ts';
import { auditStatement } from '../audit.ts';
import {
  approveRemoval,
  cancelJob,
  createLink,
  queueJob,
  rejectRemoval,
  retryRemovalMedia,
  setTeardownPublished,
  updateApp,
  updateLink,
  updateProgramStatus,
  updateStore,
  updateTheme,
  type ActionContext,
  type ActionResult,
} from '../actions.ts';
import { flashText } from '../flash.ts';
import {
  getLink,
  getRecentAudit,
  getRemoval,
  getStoreMediaSummary,
  listLinks,
  listRemovalRequests,
  type RemovalRow,
} from '../queries.ts';
import {
  AdminIndexOutput,
  ActionOutcomeSchema,
  CancelJobInput,
  CaptureStatusSchema,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  GetCaptureStatusInput,
  GetRemovalRequestInput,
  IngestScansInput,
  IngestScansOutput,
  ListAffiliateLinksOutput,
  ListAuditInput,
  ListAuditOutput,
  ListCaptureBlocksInput,
  ListCaptureBlocksOutput,
  ListCaptureTargetsInput,
  ListCaptureTargetsOutput,
  ListRemovalRequestsInput,
  ListRemovalRequestsOutput,
  PurgeRemovalRecordsInput,
  PurgeRemovalRecordsOutput,
  QueueJobInput,
  RemovalRequestDetailSchema,
  SetTeardownPublishedInput,
  UpdateAffiliateLinkInput,
  UpdateAffiliateProgramInput,
  UpdateAppInput,
  UpdateRemovalRequestInput,
  UpdateRemovalRequestOutput,
  UpdateStoreInput,
  UpdateStoreOutput,
  UpdateThemeInput,
} from './schemas.ts';

export const ADMIN_API_BASE = '/api/v1/admin';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
function principal(ctx: Ctx): Principal {
  const p = ctx.request?.principal;
  // The mount guard always sets it; this is defence in depth.
  if (!p) throw new ApiError('unauthorized', 'Sign in required.');
  return p;
}

function actionCtx(ctx: Ctx): ActionContext {
  return { db: ctx.db, actor: principal(ctx).actor, now: ctx.now(), media: ctx.mediaStore };
}

/** Result keys of failed actions → API error codes. */
const FAILURES: Record<string, ErrorCode> = {
  not_found: 'not_found',
  unknown_store: 'not_found',
  bad_request: 'bad_request',
  too_long: 'validation_error',
  bad_url: 'validation_error',
  bad_domain: 'validation_error',
  bad_country: 'validation_error',
  bad_category: 'validation_error',
  bad_program: 'validation_error',
  bad_target: 'validation_error',
  name_required: 'validation_error',
  confirm_required: 'validation_error',
  note_required: 'validation_error',
  already_handled: 'conflict',
  already_queued: 'conflict',
  not_cancellable: 'conflict',
  opted_out: 'conflict',
  capture_blocked: 'conflict',
  store_not_active: 'conflict',
  media_unavailable: 'internal_error',
  media_failed: 'internal_error',
};

const message = (key: string) => flashText(key) ?? key;

/** The outcome of a successful action, or the action's failure as an ApiError. */
function outcome(result: ActionResult): { result: string; message: string } {
  if (!result.ok) {
    throw new ApiError(FAILURES[result.flash] ?? 'bad_request', message(result.flash), {
      details: [{ path: '(action)', message: result.flash }],
    });
  }
  return { result: result.flash, message: message(result.flash) };
}

function removalOut(r: RemovalRow) {
  return {
    id: r.id,
    reference: r.reference,
    domain: r.domain,
    email: r.email,
    name: r.name,
    reason: r.reason,
    scope: r.scope,
    status: r.status,
    admin_note: r.admin_note,
    created_at: r.created_at,
    handled_at: r.handled_at,
    store: r.store_status ? { domain: r.domain, name: r.store_name, status: r.store_status } : null,
    capture_blocked: r.capture_blocked === 1,
    admin_href: `/admin/removals/${r.id}`,
  };
}

async function removalOrNotFound(ctx: Ctx, id: number): Promise<RemovalRow> {
  const row = await getRemoval(ctx.db, id);
  if (!row) throw new ApiError('not_found', `Removal request ${id} not found`);
  return row;
}

async function idBySlug(ctx: Ctx, table: 'apps' | 'themes' | 'teardowns', slug: string) {
  const row = await ctx.db.first<{ id: number }>(`SELECT id FROM ${table} WHERE slug = ?`, [slug]);
  if (!row) throw new ApiError('not_found', `${table.slice(0, -1)} '${slug}' not found`);
  return row.id;
}

const pageInfo = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit)),
});

const domainOrInvalid = (input: string): string => {
  const domain = normalizeDomain(input);
  if (!domain) {
    throw new ApiError('validation_error', 'Not a valid domain', {
      details: [{ path: 'domain', message: 'Not a valid domain' }],
    });
  }
  return domain;
};

const tags = {
  removals: ['Admin: removal requests'],
  capture: ['Admin: capture blocks'],
  catalogue: ['Admin: catalogue'],
  affiliates: ['Admin: affiliates'],
  meta: ['Admin: meta'],
};

// ---------------------------------------------------------------------------------------------
// Removal requests
// ---------------------------------------------------------------------------------------------
const listRemovalRequestsEndpoint = defineEndpoint({
  id: 'adminListRemovalRequests',
  method: 'GET',
  path: '/removal-requests',
  summary: 'List removal requests',
  description:
    'Filter by status. Pending requests list oldest first; handled ones by latest decision.',
  tags: tags.removals,
  cache: 'no-store',
  input: ListRemovalRequestsInput,
  output: ListRemovalRequestsOutput,
  handler: async (input, ctx) => {
    const r = await listRemovalRequests(ctx.db, input);
    return {
      data: { items: r.rows.map(removalOut), page: pageInfo(r.page, r.limit, r.total) },
    };
  },
});

const getRemovalRequestEndpoint = defineEndpoint({
  id: 'adminGetRemovalRequest',
  method: 'GET',
  path: '/removal-requests/{id}',
  summary: 'Get one removal request',
  tags: tags.removals,
  cache: 'no-store',
  input: GetRemovalRequestInput,
  output: RemovalRequestDetailSchema,
  handler: async (input, ctx) => {
    const row = await removalOrNotFound(ctx, input.id);
    const [media, block] = await Promise.all([
      getStoreMediaSummary(ctx.db, row.store_id, row.domain),
      captureBlockFor(ctx.db, row.domain),
    ]);
    return {
      data: {
        request: removalOut(row),
        capture_block: block,
        store_media: {
          screenshots: media.screenshots,
          placeholders: media.placeholders,
          r2_objects: media.r2Objects,
          sections: media.sections,
          teardowns_published: media.teardownsPublished,
          queued_jobs: media.queuedJobs,
          tombstoned: media.tombstoned > 0,
        },
      },
    };
  },
});

const updateRemovalRequestEndpoint = defineEndpoint({
  id: 'adminUpdateRemovalRequest',
  method: 'POST',
  path: '/removal-requests/{id}',
  summary: 'Approve, reject or complete a removal request',
  description:
    "approve (needs confirm: true): scope 'store' opts the store out everywhere; 'store' and 'screenshots' retire its screenshots, delete its media and block all future captures; 'details' is marked done. reject needs a note. complete retries the media deletion of an approved request. Audited.",
  tags: tags.removals,
  cache: 'no-store',
  input: UpdateRemovalRequestInput,
  output: UpdateRemovalRequestOutput,
  handler: async (input, ctx) => {
    await removalOrNotFound(ctx, input.id);
    const actx = actionCtx(ctx);
    const note = input.note?.trim() || null;
    const result =
      input.action === 'approve'
        ? await approveRemoval(actx, input.id, { note, confirmed: input.confirm })
        : input.action === 'reject'
          ? await rejectRemoval(actx, input.id, { note })
          : await retryRemovalMedia(actx, input.id);
    const done = outcome(result);
    const row = await removalOrNotFound(ctx, input.id);
    return {
      data: {
        ...done,
        deleted_media: result.flash === 'removal_done' ? (result.n ?? 0) : null,
        request: removalOut(row),
      },
    };
  },
});

const purgeRemovalRecordsEndpoint = defineEndpoint({
  id: 'adminPurgeRemovalRecords',
  method: 'POST',
  path: '/maintenance/purge-removal-records',
  summary: 'Purge removal records past the 2-year retention',
  description:
    'Deletes done/rejected requests closed more than REMOVAL_RECORD_RETENTION_DAYS (730) ago. Capture blocks and tombstones are kept. dry_run counts only. Audited when it deletes anything. Safe to run daily.',
  tags: tags.removals,
  cache: 'no-store',
  input: PurgeRemovalRecordsInput,
  output: PurgeRemovalRecordsOutput,
  handler: async (input, ctx) => ({
    data: await purgeExpiredRemovalRecords(ctx.db, ctx.now(), {
      actor: principal(ctx).actor,
      dryRun: input.dry_run,
    }),
  }),
});

// ---------------------------------------------------------------------------------------------
// Capture blocks (the capture pipeline's contract, see docs/ARCHITECTURE.md)
// ---------------------------------------------------------------------------------------------
const listCaptureBlocksEndpoint = defineEndpoint({
  id: 'adminListCaptureBlocks',
  method: 'GET',
  path: '/capture-blocks',
  summary: 'List domains that must never be captured',
  tags: tags.capture,
  cache: 'no-store',
  input: ListCaptureBlocksInput,
  output: ListCaptureBlocksOutput,
  handler: async (input, ctx) => {
    const { items, total } = await listCaptureBlocks(ctx.db, {
      limit: input.limit,
      offset: (input.page - 1) * input.limit,
    });
    return { data: { items, page: pageInfo(input.page, input.limit, total) } };
  },
});

const getCaptureStatusEndpoint = defineEndpoint({
  id: 'adminGetCaptureStatus',
  method: 'GET',
  path: '/capture-status/{domain}',
  summary: 'May this domain be captured?',
  description: 'The capture pipeline calls this right before each capture: blocked → skip.',
  tags: tags.capture,
  cache: 'no-store',
  input: GetCaptureStatusInput,
  output: CaptureStatusSchema,
  handler: async (input, ctx) => {
    const domain = domainOrInvalid(input.domain);
    const block = await captureBlockFor(ctx.db, domain);
    return { data: { domain, blocked: block !== null, block } };
  },
});

const listCaptureTargetsEndpoint = defineEndpoint({
  id: 'adminListCaptureTargets',
  method: 'GET',
  path: '/capture-targets',
  summary: 'Stores the capture pipeline may capture',
  description:
    'Active stores that are neither tombstoned nor capture-blocked, in catalogue order. The only work list the capture pipeline may use.',
  tags: tags.capture,
  cache: 'no-store',
  input: ListCaptureTargetsInput,
  output: ListCaptureTargetsOutput,
  handler: async (input, ctx) => {
    const r = await listCaptureTargets(ctx.db, {
      scope: input.scope,
      limit: input.limit,
      after: input.cursor ? Number(input.cursor) : null,
    });
    return {
      data: {
        items: r.items.map(({ list_position: _p, ...t }) => t),
        next_cursor: r.next_after === null ? null : String(r.next_after),
        total: r.total,
      },
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Stores and jobs
// ---------------------------------------------------------------------------------------------
const updateStoreEndpoint = defineEndpoint({
  id: 'adminUpdateStore',
  method: 'POST',
  path: '/stores/{domain}',
  summary: 'Edit a store',
  description:
    'Only the fields sent change. Hiding/unhiding or (un)curating rebuilds public counts. An opted-out store keeps that status. Audited.',
  tags: tags.catalogue,
  cache: 'no-store',
  input: UpdateStoreInput,
  output: UpdateStoreOutput,
  handler: async (input, ctx) => {
    const domain = domainOrInvalid(input.domain);
    const current = await ctx.db.first<{
      name: string | null;
      category_slug: string | null;
      country: string | null;
      is_curated: number;
    }>('SELECT name, category_slug, country, is_curated FROM stores WHERE domain = ?', [domain]);
    if (!current) throw new ApiError('not_found', `Store '${domain}' not found`);
    const done = outcome(
      await updateStore(actionCtx(ctx), domain, {
        name: input.name === undefined ? current.name : input.name || null,
        category: input.category === undefined ? current.category_slug : input.category || null,
        country: input.country === undefined ? current.country : input.country || null,
        status: input.status ?? null,
        curated: input.curated ?? current.is_curated === 1,
      }),
    );
    const after = await ctx.db.first<{
      name: string | null;
      category_slug: string | null;
      country: string | null;
      status: string;
      is_curated: number;
    }>('SELECT name, category_slug, country, status, is_curated FROM stores WHERE domain = ?', [
      domain,
    ]);
    return {
      data: {
        ...done,
        store: {
          domain,
          name: after?.name ?? null,
          category: after?.category_slug ?? null,
          country: after?.country ?? null,
          status: after?.status ?? 'active',
          is_curated: after?.is_curated === 1,
          capture_blocked: await isCaptureBlocked(ctx.db, domain),
        },
      },
    };
  },
});

const queueJobEndpoint = defineEndpoint({
  id: 'adminQueueJob',
  method: 'POST',
  path: '/jobs',
  summary: 'Queue a detect, rescan or capture job',
  description:
    'Refused (409) for opted-out domains, for duplicates of a queued/running job, and for captures of capture-blocked domains. Audited.',
  tags: tags.catalogue,
  cache: 'no-store',
  successStatus: 201,
  input: QueueJobInput,
  output: ActionOutcomeSchema,
  handler: async (input, ctx) => ({
    data: outcome(
      await queueJob(actionCtx(ctx), {
        domain: input.domain,
        kind: input.kind,
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      }),
    ),
  }),
});

const cancelJobEndpoint = defineEndpoint({
  id: 'adminCancelJob',
  method: 'POST',
  path: '/jobs/{id}/cancel',
  summary: 'Cancel a queued job',
  tags: tags.catalogue,
  cache: 'no-store',
  input: CancelJobInput,
  output: ActionOutcomeSchema,
  handler: async (input, ctx) => ({ data: outcome(await cancelJob(actionCtx(ctx), input.id)) }),
});

// ---------------------------------------------------------------------------------------------
// Themes, apps, teardowns
// ---------------------------------------------------------------------------------------------
const updateThemeEndpoint = defineEndpoint({
  id: 'adminUpdateTheme',
  method: 'POST',
  path: '/themes/{slug}',
  summary: 'Edit or hide a theme',
  description: 'Only the fields sent change. Audited.',
  tags: tags.catalogue,
  cache: 'no-store',
  input: UpdateThemeInput,
  output: ActionOutcomeSchema,
  handler: async (input, ctx) => {
    const id = await idBySlug(ctx, 'themes', input.slug);
    return {
      data: outcome(
        await updateTheme(actionCtx(ctx), id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.price_label !== undefined ? { priceLabel: input.price_label || null } : {}),
          ...(input.marketplace !== undefined ? { marketplace: input.marketplace || null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        }),
      ),
    };
  },
});

const updateAppEndpoint = defineEndpoint({
  id: 'adminUpdateApp',
  method: 'POST',
  path: '/apps/{slug}',
  summary: 'Edit or hide an app',
  description: 'Only the fields sent change. Audited.',
  tags: tags.catalogue,
  cache: 'no-store',
  input: UpdateAppInput,
  output: ActionOutcomeSchema,
  handler: async (input, ctx) => {
    const id = await idBySlug(ctx, 'apps', input.slug);
    let categoryId: number | null | undefined;
    if (input.category !== undefined) {
      if (!input.category) categoryId = null;
      else {
        const cat = await ctx.db.first<{ id: number }>(
          'SELECT id FROM app_categories WHERE slug = ?',
          [input.category],
        );
        if (!cat) throw new ApiError('validation_error', message('bad_category'));
        categoryId = cat.id;
      }
    }
    return {
      data: outcome(
        await updateApp(actionCtx(ctx), id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(input.tagline !== undefined ? { tagline: input.tagline || null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        }),
      ),
    };
  },
});

const setTeardownPublishedEndpoint = defineEndpoint({
  id: 'adminSetTeardownPublished',
  method: 'POST',
  path: '/teardowns/{slug}',
  summary: 'Publish or unpublish a teardown',
  tags: tags.catalogue,
  cache: 'no-store',
  input: SetTeardownPublishedInput,
  output: ActionOutcomeSchema,
  handler: async (input, ctx) => {
    const id = await idBySlug(ctx, 'teardowns', input.slug);
    return { data: outcome(await setTeardownPublished(actionCtx(ctx), id, input.published)) };
  },
});

// ---------------------------------------------------------------------------------------------
// Affiliates (public referral URLs: data, not secrets)
// ---------------------------------------------------------------------------------------------
const listAffiliateLinksEndpoint = defineEndpoint({
  id: 'adminListAffiliateLinks',
  method: 'GET',
  path: '/affiliate-links',
  summary: 'List affiliate links with click counts',
  tags: tags.affiliates,
  cache: 'no-store',
  input: z.object({}),
  output: ListAffiliateLinksOutput,
  handler: async (_input, ctx) => {
    const rows = await listLinks(ctx.db, ctx.now());
    return { data: { items: rows.map((r) => ({ ...r, active: r.active === 1 })) } };
  },
});

const createAffiliateLinkEndpoint = defineEndpoint({
  id: 'adminCreateAffiliateLink',
  method: 'POST',
  path: '/affiliate-links',
  summary: 'Add an affiliate link',
  tags: tags.affiliates,
  cache: 'no-store',
  successStatus: 201,
  input: CreateAffiliateLinkInput,
  output: CreateAffiliateLinkOutput,
  handler: async (input, ctx) => {
    const ref =
      input.target_type === 'vendor'
        ? input.target_slug
        : String(
            await idBySlug(ctx, input.target_type === 'app' ? 'apps' : 'themes', input.target_slug),
          );
    const result = await createLink(actionCtx(ctx), {
      target: `${input.target_type}:${ref}`,
      url: input.url,
      label: input.label ?? null,
      programId: input.program_id ?? null,
      active: input.active,
    });
    return { data: { ...outcome(result), id: result.id ?? null } };
  },
});

const updateAffiliateLinkEndpoint = defineEndpoint({
  id: 'adminUpdateAffiliateLink',
  method: 'POST',
  path: '/affiliate-links/{id}',
  summary: 'Edit or deactivate an affiliate link',
  description: 'Only the fields sent change. Inactive links 404 at /go/<id>. Audited.',
  tags: tags.affiliates,
  cache: 'no-store',
  input: UpdateAffiliateLinkInput,
  output: ActionOutcomeSchema,
  handler: async (input, ctx) => {
    const link = await getLink(ctx.db, input.id);
    if (!link) throw new ApiError('not_found', `Affiliate link ${input.id} not found`);
    return {
      data: outcome(
        await updateLink(actionCtx(ctx), input.id, {
          url: input.url ?? link.url,
          label: input.label === undefined ? link.label : input.label || null,
          programId: input.program_id === undefined ? link.program_id : input.program_id,
          active: input.active ?? link.active === 1,
        }),
      ),
    };
  },
});

const updateAffiliateProgramEndpoint = defineEndpoint({
  id: 'adminUpdateAffiliateProgram',
  method: 'POST',
  path: '/affiliate-programs/{id}',
  summary: 'Set an affiliate program status',
  tags: tags.affiliates,
  cache: 'no-store',
  input: UpdateAffiliateProgramInput,
  output: ActionOutcomeSchema,
  handler: async (input, ctx) => ({
    data: outcome(await updateProgramStatus(actionCtx(ctx), input.id, input.status)),
  }),
});

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------
const listAuditEndpoint = defineEndpoint({
  id: 'adminListAudit',
  method: 'GET',
  path: '/audit',
  summary: 'Recent audit log entries',
  tags: tags.meta,
  cache: 'no-store',
  input: ListAuditInput,
  output: ListAuditOutput,
  handler: async (input, ctx) => {
    const rows = await getRecentAudit(ctx.db, {
      limit: input.limit,
      excludeAuth: !input.include_auth,
      ...(input.target_type ? { targetType: input.target_type } : {}),
      ...(input.target_id ? { targetId: input.target_id } : {}),
    });
    return {
      data: {
        items: rows.map(({ detail_json, ...r }) => {
          let detail: unknown = null;
          try {
            detail = detail_json ? JSON.parse(detail_json) : null;
          } catch {
            detail = detail_json;
          }
          return { ...r, detail };
        }),
      },
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// Scans (crawler ingest)
// ---------------------------------------------------------------------------------------------
const ingestScansEndpoint = defineEndpoint({
  id: 'adminIngestScans',
  method: 'POST',
  path: '/scans',
  summary: 'Ingest crawler scans',
  description:
    'One home-page scan (theme, apps, pixels, storefront facts) into the detection history, then rebuilds derived counts unless `rebuild` is false (send false for all but the last scan of a batch). Opted-out and unknown domains are refused per item. Apps not seen are not closed by a single scan. Audited.',
  tags: tags.catalogue,
  cache: 'no-store',
  input: IngestScansInput,
  output: IngestScansOutput,
  handler: async (input, ctx) => {
    const results = [];
    for (const scan of input.scans) results.push(await ingestScan(ctx.db, scan));
    const ingested = results.filter((r) => r.status === 'ingested' || r.status === 'not-shopify');
    if (ingested.length && input.rebuild) await rebuildDerived(ctx.db);
    await ctx.db.batch([
      auditStatement(
        {
          actor: principal(ctx).actor,
          action: 'scans.ingest',
          targetType: 'scan',
          detail: {
            total: results.length,
            ingested: ingested.length,
            domains: results.map((r) => `${r.domain}:${r.status}`),
          },
        },
        ctx.now(),
      ),
    ]);
    return { data: { results } };
  },
});

const rest = [
  ingestScansEndpoint,
  listRemovalRequestsEndpoint,
  getRemovalRequestEndpoint,
  updateRemovalRequestEndpoint,
  purgeRemovalRecordsEndpoint,
  listCaptureBlocksEndpoint,
  getCaptureStatusEndpoint,
  listCaptureTargetsEndpoint,
  updateStoreEndpoint,
  queueJobEndpoint,
  cancelJobEndpoint,
  updateThemeEndpoint,
  updateAppEndpoint,
  setTeardownPublishedEndpoint,
  listAffiliateLinksEndpoint,
  createAffiliateLinkEndpoint,
  updateAffiliateLinkEndpoint,
  updateAffiliateProgramEndpoint,
  listAuditEndpoint,
] as const;

const adminIndexEndpoint = defineEndpoint({
  id: 'adminIndex',
  method: 'GET',
  path: '',
  summary: 'Admin API index',
  description: 'Who you are signed in as, and every admin endpoint.',
  tags: tags.meta,
  cache: 'no-store',
  input: z.object({}),
  output: AdminIndexOutput,
  handler: async (_input, ctx) => ({
    data: {
      name: `${SITE_NAME} admin API`,
      openapi: `${ADMIN_API_BASE}/openapi.json`,
      principal: principal(ctx),
      endpoints: (rest as readonly EndpointDef[]).map((e) => ({
        id: e.id,
        method: e.method,
        path: `${ADMIN_API_BASE}${e.path}`,
        summary: e.summary,
      })),
    },
  }),
});

export const adminEndpointList: readonly EndpointDef[] = [
  adminIndexEndpoint,
  ...rest,
] as readonly EndpointDef[];
