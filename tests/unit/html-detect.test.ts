import { describe, expect, it } from 'vitest';
import { compileRules, detectFromHtml } from '../../src/server/crawl/html-detect.ts';

const rules = compileRules({
  version: 'test',
  apps: {
    klaviyo: { d: ['static.klaviyo.com'] },
    hextom1: { d: ['cdn.hextom.com'] },
    hextom2: { d: ['cdn.hextom.com'] },
    judgeme: { h: ['judgeme'], a: ['judge-me'] },
    aftership: { p: ['button.aftership.com/all.js'] },
    upsell: { a: ['upsell'] },
  },
  themes: { '855': 'Prestige' },
});

const page = (body: string) =>
  `<html><head><title>Store</title><script>var Shopify = Shopify || {};Shopify.shop = "x.myshopify.com";
Shopify.currency = {"active":"GBP","rate":"1.0"};
Shopify.theme = {"name":"Prestige - BF sale","id":1,"schema_name":"Prestige","schema_version":"9.3.0","theme_store_id":855,"role":"main"};</script>
<meta property="og:site_name" content="Acme &amp; Co"></head><body>${body}</body></html>`;

describe('detectFromHtml', () => {
  it('reads the theme, currency and site name Shopify prints', () => {
    const d = detectFromHtml(page(''), rules);
    expect(d.platform).toBe('shopify');
    expect(d.theme).toEqual({
      name: 'Prestige',
      raw_name: 'Prestige - BF sale',
      version: '9.3.0',
      theme_store_id: 855,
      is_custom: false,
    });
    expect(d.currency).toBe('GBP');
    expect(d.site_name).toBe('Acme & Co');
  });

  it('names apps only from precise signals', () => {
    const d = detectFromHtml(
      page(`<script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>
<script src="https://cdn.hextom.com/js/a.js"></script>
<!-- BEGIN app block: shopify://apps/judgeme/blocks/preview_badge/123 -->
<script src="https://cdn.shopify.com/extensions/abc/upsell-12/assets/u.js"></script>
<script src="//button.aftership.com/all.js"></script>`),
      rules,
    );
    // hextom: a host shared by two rules names a vendor, not an app; "upsell" is generic.
    expect(d.apps.map((a) => a.slug)).toEqual(['aftership', 'judgeme', 'klaviyo']);
  });

  it('stops on bot checks and non-Shopify pages', () => {
    expect(
      detectFromHtml('<html><head><title>Verifying your connection...</title>', rules).platform,
    ).toBe('challenge');
    expect(detectFromHtml('<html><head><title>Hi</title></head></html>', rules).platform).toBe(
      'not-shopify',
    );
  });
});
