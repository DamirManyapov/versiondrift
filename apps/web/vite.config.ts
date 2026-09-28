import { existsSync, readFile } from 'node:fs';
import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev only: serve a locally built feed (pnpm collect --out .feed) at /feed/. Used automatically when
 * ../../.feed/v1/index.json exists and PUBLIC_FEED_URL is unset or /feed/ (set it for server-side loads to use the
 * local feed too); FEED_DIR points elsewhere.
 */
function localFeed(): Plugin {
  const dir = path.resolve(process.env.FEED_DIR ?? path.join(import.meta.dirname, '../../.feed'));
  return {
    name: 'versiondrift-local-feed',
    configureServer(server) {
      // PUBLIC_FEED_URL=/feed/ may be set on purpose: SvelteKit reads it at start, so server-side loads use it too.
      const url = process.env.PUBLIC_FEED_URL;
      if ((url && url !== '/feed/') || !existsSync(path.join(dir, 'v1/index.json'))) return;
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
  // better-sqlite3 finds its native binary next to its own files, so it can't be bundled; the Node image ships it
  // in node_modules (it's a direct dependency for that reason).
  ssr: { external: ['better-sqlite3'] },
  resolve: {
    // Workers have no SQLite: the Cloudflare build gets a stub instead of the self-hosted store (better-sqlite3).
    // The same for the other self-hosted-only packages that Workers can't load (mail, scheduling).
    alias:
      process.env.VD_ADAPTER === 'cloudflare'
        ? {
            '@versiondrift/db': path.join(import.meta.dirname, 'src/lib/server/db-unavailable.ts'),
            '@versiondrift/detect': path.join(import.meta.dirname, 'src/lib/server/detect-unavailable.ts'),
            nodemailer: path.join(import.meta.dirname, 'src/lib/server/node-only.ts'),
            croner: path.join(import.meta.dirname, 'src/lib/server/node-only.ts'),
          }
        : {},
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
