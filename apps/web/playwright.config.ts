// End-to-end tests on the Node build: `pnpm build:node && pnpm e2e` (docs/09: Playwright). Two servers — the public
// site and a self-hosted instance — over the fixed feed in e2e/feed (node e2e/make-feed.ts refreshes it).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Reduced motion turns off the controls' colour transitions (global.css), so axe never samples a colour mid-fade.
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'public', testMatch: 'public.spec.ts', use: { baseURL: 'http://localhost:4173' } },
    { name: 'selfhosted', testMatch: 'selfhosted.spec.ts', use: { baseURL: 'http://localhost:4174' } },
    { name: 'fleet', testMatch: 'fleet.spec.ts', use: { baseURL: 'http://localhost:4175' } },
    // The fleet server under a LAN name over plain http: not a secure context, like http://192.168.1.10:8080.
    {
      name: 'lan',
      testMatch: 'lan.spec.ts',
      use: {
        baseURL: 'http://lan.test:4175',
        launchOptions: { args: ['--host-resolver-rules=MAP lan.test 127.0.0.1'] },
      },
    },
  ],
  webServer: [
    {
      command: 'node e2e/serve.ts selfhosted 4174',
      url: 'http://localhost:4174/healthz',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/serve.ts fleet 4175',
      url: 'http://localhost:4175/healthz',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/serve.ts public 4173',
      url: 'http://localhost:4173/healthz',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
