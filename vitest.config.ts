import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run on Node with the node:sqlite adapter (same SQL as D1). They never touch
// `cloudflare:workers`; the Worker-bound entry points are thin wrappers around tested code.
export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // node:sqlite is stable enough for tests; hide its ExperimentalWarning noise.
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
