import { afterAll, describe, expect, it } from 'vitest';
import { affiliateRedirect } from '../../src/server/repo/affiliate.ts';
import { isServableKey, serveMedia } from '../../src/server/media/serve.ts';
import { FIXED_NOW, seededDb } from './helpers/db.ts';

const db = seededDb();
afterAll(() => db.close());

const req = (method = 'GET', ua = 'Mozilla/5.0') =>
  new Request('https://test.local/go/1', { method, headers: { 'User-Agent': ua } });
const clicks = async (id: number) =>
  (
    await db.first<{ count: number }>(
      "SELECT count FROM clicks WHERE link_id = ? AND day = '2026-11-17'",
      [id],
    )
  )?.count ?? 0;

describe('/go/<id>', () => {
  it('302s to the affiliate URL and counts the click per day', async () => {
    const link = await db.first<{ id: number; url: string }>(
      'SELECT id, url FROM affiliate_links WHERE target_id IS NOT NULL AND active = 1 ORDER BY id',
    );
    if (!link) throw new Error('seed has no resolved affiliate link');
    const res = await affiliateRedirect(db, String(link.id), req(), FIXED_NOW);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(link.url);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(await clicks(link.id)).toBe(1);
    await affiliateRedirect(db, String(link.id), req(), FIXED_NOW);
    expect(await clicks(link.id)).toBe(2);
  });

  it('does not count HEAD requests or bots', async () => {
    await affiliateRedirect(db, '2', req('HEAD'), FIXED_NOW);
    await affiliateRedirect(db, '2', req('GET', 'Slackbot-LinkExpanding 1.0'), FIXED_NOW);
    expect(await clicks(2)).toBe(0);
  });

  it('404s unknown and inactive links', async () => {
    expect((await affiliateRedirect(db, '99999', req(), FIXED_NOW)).status).toBe(404);
    expect((await affiliateRedirect(db, 'abc', req(), FIXED_NOW)).status).toBe(404);
    await db.run('UPDATE affiliate_links SET active = 0 WHERE id = 3');
    const res = await affiliateRedirect(db, '3', req(), FIXED_NOW);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });
});

describe('/media/<key>', () => {
  const object = (key: string) => ({
    key,
    size: 3,
    httpEtag: '"abc"',
    body: new Blob(['img']).stream(),
    writeHttpMetadata: (h: Headers) => h.set('Content-Type', 'image/webp'),
  });
  const bucket = {
    get: async (key: string) => (key === 'shots/a.webp' ? object(key) : null),
  } as unknown as R2Bucket;
  const media = (key: string) =>
    serveMedia(bucket, key, new Request(`https://test.local/media/${key}`));

  it('streams R2 objects with immutable caching', async () => {
    const res = await media('shots/a.webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(await res.text()).toBe('img');
  });

  it('404s missing objects, placeholders and unsafe keys', async () => {
    expect((await media('shots/missing.webp')).status).toBe(404);
    expect((await media('placeholder/shot/1.svg')).status).toBe(404);
    expect(isServableKey('../secret')).toBe(false);
    expect(isServableKey('shots//a.webp')).toBe(false);
    expect(isServableKey('shots/youngla.com/home/desktop/2026-11-17.webp')).toBe(true);
  });
});
