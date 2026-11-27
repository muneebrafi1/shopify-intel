#!/usr/bin/env node
/**
 * Runner for rebuild-page-cache.ts: Vite resolves `~` aliases and `import.meta.env`.
 * Extra args after this file are forwarded (parseArgs in the script reads process.argv).
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '~': resolve(root, 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: {
    middlewareMode: true,
    preTransformRequests: false,
    hmr: false,
    watch: { ignored: ['**'] },
  },
  appType: 'custom',
  envPrefix: ['PUBLIC_', 'VITRINE_'],
  logLevel: 'error',
});
try {
  await server.ssrLoadModule('/scripts/ops/rebuild-page-cache.ts');
} finally {
  await server.close();
}
