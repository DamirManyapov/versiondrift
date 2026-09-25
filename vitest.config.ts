import { defineConfig } from 'vitest/config';

// Runs every package's tests from the root (watch mode, IDE). CI uses `pnpm -r test`.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
