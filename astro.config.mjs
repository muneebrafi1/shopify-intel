// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { SITE_URL } from './src/config/site.ts';

// Canonical origin. The brand/domain lives in src/config/site.ts (SITE_DOMAIN); PUBLIC_SITE_URL
// overrides it per environment (e.g. a preview deployment).
const site = process.env.PUBLIC_SITE_URL || SITE_URL;

export default defineConfig({
  site,
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Astro sessions are not used (admin uses its own signed cookie), so no KV namespace is needed.
  session: false,
  trailingSlash: 'never',
  build: { format: 'file' },
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  vite: {
    resolve: { alias: { '~': new URL('./src', import.meta.url).pathname } },
  },
});
