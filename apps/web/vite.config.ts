import { existsSync, readFile } from 'node:fs';
import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev only: serve a locally built feed (pnpm collect --out .feed) at /feed/. Used automatically when
 * ../../.feed/v1/index.json exists and PUBLIC_FEED_URL is not set; FEED_DIR points elsewhere.
 */
function localFeed(): Plugin {
  const dir = path.resolve(process.env.FEED_DIR ?? path.join(import.meta.dirname, '../../.feed'));
  return {
    name: 'versiondrift-local-feed',
    configureServer(server) {
      if (process.env.PUBLIC_FEED_URL || !existsSync(path.join(dir, 'v1/index.json'))) return;
      process.env.PUBLIC_FEED_URL = '/feed/';
      server.config.logger.info(`  serving the local feed from ${dir} at /feed/`);
      server.middlewares.use('/feed', (req, res) => {
        const file = path.join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname));
        if (!file.startsWith(dir + path.sep)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        readFile(file, (error, data) => {
          res.statusCode = error ? 404 : 200;
          if (!error)
            res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'text/plain');
          res.end(error ? undefined : data);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [localFeed(), sveltekit()],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
