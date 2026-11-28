import { describe, expect, it } from 'vitest';
import { absolutizeMedia } from '../../src/server/media/urls.ts';

describe('absolutizeMedia', () => {
  const tree = {
    data: {
      icon_url: '/media/icons/apps/klaviyo.f84f0aab.webp',
      other_icon_url: '/media/x.webp',
      href: '/apps/klaviyo',
      items: [
        { logo_url: '/media/icons/stores/a.png', src: '/media/shots/a/home/desktop/1.webp' },
        { icon_url: 'https://cdn.shopify.com/x.png', src: '/not-media/x' },
        { icon_url: null },
      ],
    },
  };
  const out = absolutizeMedia(tree, 'https://vitrine.example/');

  it('prefixes icon_url, logo_url and image src that point at /media/', () => {
    expect(out.data.icon_url).toBe('https://vitrine.example/media/icons/apps/klaviyo.f84f0aab.webp');
    expect(out.data.items[0]).toEqual({
      logo_url: 'https://vitrine.example/media/icons/stores/a.png',
      src: 'https://vitrine.example/media/shots/a/home/desktop/1.webp',
    });
  });
  it('leaves other keys, absolute URLs and nulls alone, and does not mutate the input', () => {
    expect(out.data.other_icon_url).toBe('/media/x.webp');
    expect(out.data.href).toBe('/apps/klaviyo');
    expect(out.data.items[1]).toEqual({ icon_url: 'https://cdn.shopify.com/x.png', src: '/not-media/x' });
    expect(out.data.items[2]?.icon_url).toBeNull();
    expect(tree.data.icon_url.startsWith('/media/')).toBe(true);
  });
});
