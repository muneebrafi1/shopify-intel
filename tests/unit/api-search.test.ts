import { afterAll, describe, expect, it } from 'vitest';
import { setup } from './helpers/db.ts';

const { db, api } = setup();
afterAll(() => db.close());

const titles = (out: Awaited<ReturnType<typeof api.search>>, kind: string) =>
  out.data.groups.find((g) => g.kind === kind)?.items.map((i) => i.title) ?? [];

describe('search', () => {
  it('prefix-matches across kinds', async () => {
    const out = await api.search({ q: 'pre' });
    expect(titles(out, 'theme')[0]).toBe('Prestige');
    expect(out.data.is_suggestion).toBe(false);
    const hit = out.data.groups.find((g) => g.kind === 'theme')?.items[0];
    expect(hit?.href).toBe('/themes/prestige');
    expect(hit?.thumbnail?.src).toMatch(/^\/media\/placeholder\/shot\/\d+\.svg$/);
  });

  it('finds apps by brand prefix with icons, and stores by domain', async () => {
    const klav = await api.search({ q: 'klav' });
    const app = klav.data.groups.find((g) => g.kind === 'app')?.items[0];
    expect(app?.ref).toBe('klaviyo');
    expect(app?.icon_url).toMatch(/^(https:\/\/|\/media\/icons\/apps\/)/);
    const store = await api.search({ q: 'youngla', kinds: ['store'] });
    expect(store.data.groups.map((g) => g.kind)).toEqual(['store']);
    expect(store.data.groups[0]?.items[0]?.href).toBe('/stores/youngla.com');
  });

  it('matches multi-word queries on every word', async () => {
    const out = await api.search({ q: 'judge rev' });
    expect(out.data.groups.find((g) => g.kind === 'app')?.items[0]?.ref).toBe('judgeme');
  });

  it('forgives a one or two letter typo when nothing matches', async () => {
    const out = await api.search({ q: 'klavyo' });
    expect(out.data.groups.find((g) => g.kind === 'app')?.items[0]?.ref).toBe('klaviyo');
    expect((await api.search({ q: 'zzzqx' })).data.groups).toEqual([]);
  });

  it('returns suggestions for an empty query and nothing for punctuation', async () => {
    const empty = await api.search({});
    expect(empty.data.is_suggestion).toBe(true);
    expect(titles(empty, 'theme')[0]).toBe('Dawn');
    expect(titles(empty, 'app')[0]).toContain('Klaviyo');
    expect(
      empty.data.groups.find((g) => g.kind === 'store')?.items.every((i) => i.ref.length > 0),
    ).toBe(true);
    const junk = await api.search({ q: '"*)(' });
    expect(junk.data.groups).toEqual([]);
  });
});
