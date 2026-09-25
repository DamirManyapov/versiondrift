// End-to-end tests on the Node build: `pnpm build:node && pnpm e2e` (docs/09: Playwright). Two servers — the public
// site and a self-hosted instance — over the fixed feed in e2e/feed (node e2e/make-feed.ts refreshes it).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  projects: [
    { name: 'public', testMatch: 'public.spec.ts', use: { baseURL: 'http://localhost:4173' } },
    { name: 'selfhosted', testMatch: 'selfhosted.spec.ts', use: { baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    {
      command: 'node e2e/serve.ts selfhosted 4174',
      url: 'http://localhost:4174/healthz',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/serve.ts public 4173',
      url: 'http://localhost:4173/healthz',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
