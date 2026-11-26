/**
 * POST /api/whop/webhook — Whop membership events (Standard Webhooks signature, WHOP_WEBHOOK_SECRET).
 * 503 until the secret is set. Logs one line per delivery without personal data.
 */
import type { APIRoute } from 'astro';
import { accountDb, whopConfig } from '~/server/account/env';
import { handleWhopWebhook } from '~/server/whop/handle';
import { MAX_BODY_BYTES } from '~/server/whop/webhook';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return json(413, { ok: false });
  const config = whopConfig();
  const rawBody = await request.text();
  try {
    const out = await handleWhopWebhook({
      db: accountDb(),
      rawBody,
      headers: request.headers,
      secret: config.webhookSecret,
      products: config.products,
    });
    console.log(`whop webhook: ${out.status} ${out.result}${out.detail ? ` (${out.detail})` : ''}`);
    return json(out.status, { ok: out.status === 200, result: out.result });
  } catch (err) {
    console.error('whop webhook failed:', err instanceof Error ? err.message : 'unknown');
    return json(500, { ok: false });
  }
};
