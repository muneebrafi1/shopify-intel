#!/usr/bin/env node
/**
 * Generates public/og-default.png (1200x630) from SITE_NAME and SITE_TAGLINE in src/config/site.ts.
 * Re-run whenever the brand name or tagline changes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const siteConfig = readFileSync(join(ROOT, 'src/config/site.ts'), 'utf8');
const brand = /SITE_NAME = '([^']+)'/.exec(siteConfig)?.[1] ?? 'Vitrine';
const tagline =
  /SITE_TAGLINE = '([^']+)'/.exec(siteConfig)?.[1] ?? 'Real Shopify stores, page by page';

const esc = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="spot" cx="50%" cy="0%" r="75%">
      <stop offset="0%" stop-color="#cf4519" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#ffffff"/>
  <rect width="1200" height="630" fill="url(#spot)"/>

  <!-- Subtle architectural guide lines -->
  <line x1="88" y1="0" x2="88" y2="630" stroke="#e4e4e7" stroke-width="1"/>
  <line x1="1112" y1="0" x2="1112" y2="630" stroke="#e4e4e7" stroke-width="1"/>
  <line x1="0" y1="96" x2="1200" y2="96" stroke="#e4e4e7" stroke-width="1"/>
  <line x1="0" y1="528" x2="1200" y2="528" stroke="#e4e4e7" stroke-width="1"/>

  <!-- Brand mark + wordmark -->
  <g transform="translate(88, 136)">
    <g transform="scale(2.4)">
      <rect width="20" height="20" rx="5.5" fill="#cf4519"/>
      <rect x="4.5" y="4.5" width="11" height="5.5" rx="1.5" fill="#ffffff"/>
      <rect x="4.5" y="11.6" width="11" height="1.7" rx="0.85" fill="#ffffff" opacity="0.72"/>
      <rect x="4.5" y="14.5" width="6.5" height="1.7" rx="0.85" fill="#ffffff" opacity="0.5"/>
    </g>
    <text x="68" y="34" font-family="Instrument Sans, Inter, sans-serif" font-size="34" font-weight="600" letter-spacing="-0.025em" fill="#111113">${esc(brand)}</text>
  </g>

  <!-- Main headline -->
  <text x="88" y="294" font-family="Instrument Sans, Inter, sans-serif" font-size="60" font-weight="600" letter-spacing="-0.03em" fill="#111113">${esc(tagline)}.</text>
  <text x="88" y="362" font-family="Instrument Sans, Inter, sans-serif" font-size="28" font-weight="400" fill="#52525b">See which themes and apps live storefronts run, section by section,</text>
  <text x="88" y="400" font-family="Instrument Sans, Inter, sans-serif" font-size="28" font-weight="400" fill="#52525b">across home, collection, product and cart on desktop and mobile.</text>

  <!-- Bottom pills -->
  <g transform="translate(88, 456)">
    <rect x="0" y="0" width="198" height="40" rx="8" fill="#f4f4f5" stroke="#e4e4e7"/>
    <text x="18" y="25" font-family="Geist Mono, DejaVu Sans Mono, monospace" font-size="15" fill="#27272a">930 stores scanned</text>

    <rect x="214" y="0" width="232" height="40" rx="8" fill="#f4f4f5" stroke="#e4e4e7"/>
    <text x="232" y="25" font-family="Geist Mono, DejaVu Sans Mono, monospace" font-size="15" fill="#27272a">Desktop &amp; mobile views</text>

    <rect x="462" y="0" width="176" height="40" rx="8" fill="#f4f4f5" stroke="#e4e4e7"/>
    <text x="480" y="25" font-family="Geist Mono, DejaVu Sans Mono, monospace" font-size="15" fill="#27272a">Public API &amp; MCP</text>
  </g>

  <!-- Footer meta -->
  <text x="88" y="576" font-family="Geist Mono, DejaVu Sans Mono, monospace" font-size="15" fill="#71717a">INDEPENDENT SHOPIFY ECOSYSTEM LIBRARY · NO REVENUE OR TRAFFIC ESTIMATES</text>
</svg>`;

await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(join(ROOT, 'public/og-default.png'));
console.log('Generated public/og-default.png');
