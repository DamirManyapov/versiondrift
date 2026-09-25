// Starts the Node build for the e2e tests (run `pnpm build:node` first):
//   node e2e/serve.ts selfhosted 4174   — self-hosted, no sign-in, the fixed feed in e2e/feed as its local copy
//   node e2e/serve.ts public 4173       — the public site, reading that copy from the self-hosted server
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, port = '4173'] = process.argv.slice(2);
const root = path.join(import.meta.dirname, '..');

if (mode === 'selfhosted') {
  const data = await mkdtemp(path.join(tmpdir(), 'vd-e2e-'));
  await cp(path.join(import.meta.dirname, 'feed'), path.join(data, 'feed'), { recursive: true });
  Object.assign(process.env, {
    VD_MODE: 'selfhosted',
    VD_AUTH: 'none',
    VD_DATA_DIR: data,
    // Nothing to sync from: the fixed copy stays as it is.
    VD_FEED_URL: 'http://127.0.0.1:9/',
    VD_FEED_SYNC: '0 0 1 1 *',
    PUBLIC_FEED_URL: '/feed/',
  });
} else {
  process.env.PUBLIC_FEED_URL = 'http://localhost:4174/feed/';
}
Object.assign(process.env, { PORT: port, HOST: '127.0.0.1', ORIGIN: `http://localhost:${port}` });
await import(pathToFileURL(path.join(root, 'build/index.js')).href);
