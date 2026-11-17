import { afterAll, describe, expect, it } from 'vitest';
import {
  createNotifier,
  runInBackground,
  type Notifier,
  type NotifyMessage,
  type RemovalRequestEvent,
} from '../../src/server/notify.ts';
import { setup } from './helpers/db.ts';

const event: RemovalRequestEvent = {
  id: 123,
  reference: 'RR-ABCDEFGH',
  scope: 'screenshots',
  domain: 'owner-shop.example',
};

describe('createNotifier', () => {
  it('without a transport, sends nothing and logs one line without personal data', async () => {
    const lines: string[] = [];
    const notifier = createNotifier({ to: 'admin@example.com', log: (l) => lines.push(l) });
    expect(await notifier.removalRequestCreated(event)).toBe('skipped');
    expect(lines).toEqual([
      'removal_request.created id=123 scope=screenshots notify=skipped reason=no_transport',
    ]);
    expect(lines[0]).not.toContain('example');
    expect(lines[0]).not.toContain('RR-');
  });

  it('sends through a transport to ADMIN_NOTIFY_EMAIL', async () => {
    const sent: NotifyMessage[] = [];
    const lines: string[] = [];
    const notifier = createNotifier({
      to: 'admin@example.com',
      transport: { name: 'test-mail', send: async (m) => void sent.push(m) },
      log: (l) => lines.push(l),
    });
    expect(await notifier.removalRequestCreated(event)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('admin@example.com');
    expect(sent[0]?.subject).toContain('RR-ABCDEFGH');
    expect(sent[0]?.text).toContain('/admin/removals/123');
    expect(lines).toEqual([
      'removal_request.created id=123 scope=screenshots notify=sent transport=test-mail',
    ]);
  });

  it('fails safe: missing recipient, bad recipient or a failing provider never throw', async () => {
    const lines: string[] = [];
    const failing = { name: 'down', send: async () => Promise.reject(new Error('x@y.z said no')) };
    const log = (l: string) => lines.push(l);
    expect(await createNotifier({ transport: failing, log }).removalRequestCreated(event)).toBe(
      'skipped',
    );
    expect(
      await createNotifier({ to: 'not-an-email', transport: failing, log }).removalRequestCreated(
        event,
      ),
    ).toBe('skipped');
    expect(
      await createNotifier({ to: 'a@b.co', transport: failing, log }).removalRequestCreated(event),
    ).toBe('failed');
    expect(lines.map((l) => l.split(' ').slice(3).join(' '))).toEqual([
      'notify=skipped reason=no_recipient',
      'notify=skipped reason=bad_recipient',
      'notify=failed transport=down',
    ]);
    expect(lines.join('\n')).not.toContain('@');
  });

  it('runInBackground uses waitUntil when given and survives errors either way', async () => {
    const scheduled: Promise<unknown>[] = [];
    let ran = 0;
    await runInBackground(
      (p) => scheduled.push(p),
      async () => {
        ran++;
        throw new Error('boom');
      },
    );
    expect(scheduled).toHaveLength(1);
    await scheduled[0]; // resolves: the error was caught
    await runInBackground(null, async () => {
      ran++;
      throw new Error('boom');
    });
    // A waitUntil that throws (no request context) falls back to awaiting, without running twice.
    await runInBackground(
      () => {
        throw new Error('no context');
      },
      async () => {
        ran++;
      },
    );
    expect(ran).toBe(3);
  });
});

describe('new removal requests notify the admin', () => {
  const calls: RemovalRequestEvent[] = [];
  const spy: Notifier = {
    removalRequestCreated: async (e) => {
      calls.push(e);
      return 'skipped';
    },
  };
  const broken: Notifier = {
    removalRequestCreated: async () => {
      throw new Error('notifier exploded');
    },
  };
  const scheduled: Promise<unknown>[] = [];
  const ok = setup({ notifier: spy, waitUntil: (p) => scheduled.push(p) });
  const bad = setup({ notifier: broken });
  afterAll(() => {
    ok.db.close();
    bad.db.close();
  });
  const body = {
    domain: 'https://www.koh.com/',
    email: 'owner@example.com',
    reason: 'Please stop showing screenshots of our store.',
    scope: 'screenshots',
  };
  const post = (http: (r: Request) => Promise<Response>, extra: object = {}, ip = '203.0.113.9') =>
    http(
      new Request('https://test.local/api/v1/removal-requests', {
        method: 'POST',
        body: JSON.stringify({ ...body, ...extra }),
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      }),
    );

  it('is invoked once per stored request, via waitUntil, with no requester data', async () => {
    const res = await post(ok.http);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { reference: string } };
    await Promise.all(scheduled);
    expect(scheduled).toHaveLength(1);
    const row = await ok.db.first<{ id: number }>(
      'SELECT id FROM removal_requests WHERE reference = ?',
      [data.reference],
    );
    expect(calls).toEqual([
      { id: row?.id, reference: data.reference, scope: 'screenshots', domain: 'koh.com' },
    ]);
    expect(JSON.stringify(calls)).not.toContain('owner@example.com');
  });

  it('is not invoked for honeypot hits; the in-process client (opt-out form) notifies too', async () => {
    await post(ok.http, { website: 'spam' }, '203.0.113.10');
    expect(calls).toHaveLength(1);
    await ok.api.createRemovalRequest(
      { ...body, scope: 'store', domain: 'koh.com' },
      { request: { ip: '203.0.113.11' } },
    );
    expect(calls).toHaveLength(2);
  });

  it('a failing notifier never breaks the request', async () => {
    const res = await post(bad.http);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { reference: string } };
    expect(
      await bad.db.first('SELECT status FROM removal_requests WHERE reference = ?', [
        data.reference,
      ]),
    ).toEqual({ status: 'pending' });
  });
});
