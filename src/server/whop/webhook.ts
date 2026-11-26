/**
 * Whop webhooks, verified per Standard Webhooks (https://www.standardwebhooks.com/), the format
 * Whop documents at https://docs.whop.com/developer/guides/webhooks:
 *
 *   webhook-id: msg_…   webhook-timestamp: <unix seconds>   webhook-signature: v1,<base64> …
 *   signature = base64(HMAC-SHA256(key, `${id}.${timestamp}.${rawBody}`))
 *
 * The key is the UTF-8 bytes of the whole secret Whop shows for the webhook ("ws_…"): Whop's SDK
 * passes btoa(secret) to the standardwebhooks library, which base64-decodes it back to exactly
 * those bytes. TO VERIFY with a sandbox delivery before launch (docs/ACCOUNTS.md).
 *
 * Several space-separated signatures may be sent (key rotation); any valid v1 one is accepted.
 * Timestamps more than 5 minutes away from now are rejected (replay window).
 */
import { bytesEqual, hmacKey, hmacSign, parseJsonObject } from '../auth/crypto.ts';

export const TOLERANCE_SECONDS = 5 * 60;
export const MAX_BODY_BYTES = 256 * 1024;

export interface WebhookEvent {
  /** webhook-id header; the idempotency key. */
  deliveryId: string;
  type: string;
  /** Envelope timestamp (ISO), else the header timestamp. Used to ignore stale updates. */
  timestamp: string;
  data: Record<string, unknown>;
}

export type VerifyResult =
  { ok: true; event: WebhookEvent } | { ok: false; status: 400 | 401; reason: string };

function b64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The signature header value for a payload; used by tests and the local fixture sender. */
export async function signWebhook(
  secret: string | Uint8Array<ArrayBuffer>,
  id: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const sig = await hmacSign(await hmacKey(secret), `${id}.${timestamp}.${body}`);
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return `v1,${btoa(bin)}`;
}

export async function verifyWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
  now: Date = new Date(),
): Promise<VerifyResult> {
  const id = headers.get('webhook-id') ?? '';
  const ts = headers.get('webhook-timestamp') ?? '';
  const sigHeader = headers.get('webhook-signature') ?? '';
  if (!id || id.length > 128 || !/^\d{1,12}$/.test(ts) || !sigHeader)
    return { ok: false, status: 400, reason: 'missing webhook headers' };
  const tsNum = Number(ts);
  if (Math.abs(Math.floor(now.getTime() / 1000) - tsNum) > TOLERANCE_SECONDS)
    return { ok: false, status: 401, reason: 'timestamp outside tolerance' };

  const expected = await hmacSign(await hmacKey(secret), `${id}.${ts}.${rawBody}`);
  let valid = false;
  for (const part of sigHeader.split(' ')) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) continue;
    const given = b64ToBytes(value);
    if (given && bytesEqual(given, expected)) valid = true;
  }
  if (!valid) return { ok: false, status: 401, reason: 'bad signature' };

  const body = parseJsonObject(rawBody);
  const type = body?.type;
  const data = body?.data;
  if (!body || typeof type !== 'string' || !data || typeof data !== 'object' || Array.isArray(data))
    return { ok: false, status: 400, reason: 'not a Whop event' };
  const envTs = typeof body.timestamp === 'string' ? Date.parse(body.timestamp) : NaN;
  return {
    ok: true,
    event: {
      deliveryId: id,
      type,
      timestamp: new Date(Number.isFinite(envTs) ? envTs : tsNum * 1000).toISOString(),
      data: data as Record<string, unknown>,
    },
  };
}

/** The subset of a Whop Membership object Vitrine keeps. */
export interface MembershipRecord {
  id: string;
  whopUserId: string | null;
  productId: string;
  variantId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  manageUrl: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const idOf = (v: unknown) =>
  str(v) ?? (v && typeof v === 'object' ? str((v as Record<string, unknown>).id) : null);
const isoOf = (v: unknown) => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * 1000).toISOString();
  const s = str(v);
  if (!s) return null;
  const t = /^\d+$/.test(s) ? Number(s) * 1000 : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Reads a membership from event data. Tolerates both flat ids (user_id, product_id) and nested
 * objects ({ user: { id } }, { product: { id } }), since API versions differ.
 */
export function readMembership(data: Record<string, unknown>): MembershipRecord | null {
  const id = str(data.id);
  const productId = str(data.product_id) ?? idOf(data.product);
  const status = str(data.status);
  if (!id || !id.startsWith('mem_') || !productId || !status) return null;
  const manage = str(data.manage_url);
  return {
    id,
    whopUserId: str(data.user_id) ?? idOf(data.user),
    productId,
    variantId: str(data.variant_id) ?? str(data.plan_id) ?? idOf(data.plan),
    status,
    cancelAtPeriodEnd: data.cancel_at_period_end === true,
    currentPeriodEnd: isoOf(data.current_period_end) ?? isoOf(data.renewal_period_end),
    manageUrl: manage && manage.startsWith('https://') ? manage : null,
  };
}
