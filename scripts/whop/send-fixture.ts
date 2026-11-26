/**
 * Sends a signed Whop webhook fixture to a LOCAL server, to try the webhook path end to end
 * without Whop: node scripts/whop/send-fixture.ts <fixture> [--user user_…] [--product prod_…]
 *   [--url http://127.0.0.1:4321/api/whop/webhook]
 * Fixtures: tests/unit/fixtures/whop/*.json. Signs with WHOP_WEBHOOK_SECRET from .dev.vars.
 * Refuses any non-local URL.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { signWebhook } from '../../src/server/whop/webhook.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:4321/api/whop/webhook' },
    user: { type: 'string' },
    product: { type: 'string' },
    id: { type: 'string' },
  },
});
const name = positionals[0] ?? 'membership-activated';
const url = new URL(values.url!);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error('Refusing to send to a non-local URL.');
  process.exit(1);
}
const vars = readFileSync('.dev.vars', 'utf8');
const secret = /^WHOP_WEBHOOK_SECRET=(.+)$/m.exec(vars)?.[1]?.trim();
if (!secret) {
  console.error('Set WHOP_WEBHOOK_SECRET in .dev.vars first.');
  process.exit(1);
}
const event = JSON.parse(readFileSync(`tests/unit/fixtures/whop/${name}.json`, 'utf8'));
event.timestamp = new Date().toISOString();
if (values.user) {
  if ('user_id' in event.data) event.data.user_id = values.user;
  else event.data.user = { ...(event.data.user ?? {}), id: values.user };
}
if (values.product) {
  if ('product_id' in event.data) event.data.product_id = values.product;
  else event.data.product = { ...(event.data.product ?? {}), id: values.product };
}
const body = JSON.stringify(event);
const id = values.id ?? `msg_local_${Date.now()}`;
const ts = Math.floor(Date.now() / 1000);
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': await signWebhook(secret, id, ts, body),
  },
  body,
});
console.log(res.status, await res.text());
