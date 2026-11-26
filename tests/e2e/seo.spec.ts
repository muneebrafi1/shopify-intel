import { expect, test } from '@playwright/test';
import { expectHealthyPage } from './helpers';

/** XML sitemaps, OG/Twitter tags, canonicals, JSON-LD and noindex rules. */

test.describe('seo', () => {
  test('robots.txt and XML sitemaps are valid and exclude private/noindex routes', async ({
    request,
  }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Sitemap:');

    const index = await request.get('/sitemap.xml');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type']).toContain('application/xml');
    const indexXml = await index.text();
    expect(indexXml).toContain('<sitemapindex');
    expect(indexXml).toContain('/sitemaps/core.xml');
    expect(indexXml).toContain('/sitemaps/sections.xml');

    const core = await request.get('/sitemaps/core.xml');
    expect(core.status()).toBe(200);
    expect(core.headers()['content-type']).toContain('application/xml');
    const coreXml = await core.text();
    expect(coreXml).toContain('<urlset');
    expect(coreXml).toContain('/stores/youngla.com');
    expect(coreXml).toContain('/teardowns/lskd');
    expect(coreXml).toContain('/teardowns/thursdayboots');
    expect(coreXml).toContain('/teardowns/negativeunderwear');
    expect(coreXml).toContain('/pro</loc>');
    expect(coreXml).not.toContain('/admin</loc>');
    expect(coreXml).not.toContain('/account</loc>');
    expect(coreXml).not.toContain('/search</loc>');

    const sections = await request.get('/sitemaps/sections.xml');
    expect(sections.status()).toBe(200);
    expect(sections.headers()['content-type']).toContain('application/xml');
    const sectionsXml = await sections.text();
    expect(sectionsXml).toContain('<urlset');
    expect(sectionsXml).toMatch(/\/sections\/[a-z-]+\/\d+<\/loc>/);

    const ogImg = await request.get('/og-default.png');
    expect(ogImg.status()).toBe(200);
    expect(ogImg.headers()['content-type']).toContain('image/png');
  });

  for (const [path, canonicalSuffix] of [
    ['/', '/'],
    ['/pro?billing=yearly', '/pro'],
    ['/teardowns/lskd', '/teardowns/lskd'],
    ['/stores/youngla.com?page=home&device=desktop', '/stores/youngla.com'],
    ['/privacy', '/privacy'],
    ['/terms', '/terms'],
    ['/affiliate-disclosure', '/affiliate-disclosure'],
    ['/opt-out', '/opt-out'],
  ] as const) {
    test(`meta, canonical and non-SVG OG image on ${path}`, async ({ page }) => {
      await expectHealthyPage(page, path);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toMatch(
        new RegExp(`${canonicalSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      );

      const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
      expect(ogImage).toBeTruthy();
      expect(ogImage).not.toMatch(/\.svg(\?|$)/i);

      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image',
      );
      await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', ogImage!);
      await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /.+/);
    });
  }

  test('structured data covers Pro FAQ/Offers and legal WebPage schemas', async ({ page }) => {
    await expectHealthyPage(page, '/pro');
    const proLd = (await page.locator('script[type="application/ld+json"]').allTextContents()).join(
      '',
    );
    expect(proLd).toContain('"FAQPage"');
    expect(proLd).toContain('"SoftwareApplication"');
    expect(proLd).toContain('"BreadcrumbList"');

    for (const legal of ['/privacy', '/terms', '/affiliate-disclosure', '/opt-out']) {
      await page.goto(legal);
      const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join(
        '',
      );
      expect(ld).toContain('"WebPage"');
      expect(ld).toContain('"BreadcrumbList"');
    }
  });

  test('filtered search is noindex and omits default OG card', async ({ page }) => {
    await expectHealthyPage(page, '/search?q=dawn');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
