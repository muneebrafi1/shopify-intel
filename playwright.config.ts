import { defineConfig } from '@playwright/test';

/**
 * End-to-end + layout checks at the two widths every page must work at (CLAUDE.md):
 * 390px (mobile) and 1440px (desktop). Runs against the built Worker (`astro preview`, i.e.
 * workerd with the local D1), or any server via E2E_BASE_URL.
 */
const PORT = 4400;
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx astro preview --port ${PORT} --host 127.0.0.1`,
        // Probe a route that exists on every branch of the stack (the home page lands later).
        url: `${baseURL}/robots.txt`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Astro 7 backgrounds `astro preview` when it detects an AI agent; keep it in the
        // foreground so Playwright owns the process (no effect in CI).
        env: {
          ASTRO_TELEMETRY_DISABLED: '1',
          WRANGLER_SEND_METRICS: 'false',
          AI_AGENT: '',
          CLAUDECODE: '',
        },
      },
});
