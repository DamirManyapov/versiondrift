// Self-hosted mode (VD_MODE=selfhosted, docs/07): boards live in SQLite under VD_DATA_DIR. The public site keeps
// the inventory in the browser and never opens a database.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { openStorage, type Storage } from '@versiondrift/db';
import { env } from '$env/dynamic/private';

export type Mode = 'public' | 'selfhosted';

export const mode = (): Mode => (env.VD_MODE === 'selfhosted' ? 'selfhosted' : 'public');

let storage: Storage | undefined;

/** The database, opened (and migrated) on first use; 404 outside self-hosted mode so nothing exists there. */
export function selfHostedStorage(): Storage {
  if (mode() !== 'selfhosted') error(404, 'Not found');
  if (!storage) {
    const dir = path.resolve(env.VD_DATA_DIR || './data');
    mkdirSync(dir, { recursive: true });
    storage = openStorage(path.join(dir, 'versiondrift.db'), { secret: env.VD_SECRET_KEY || keyFile(dir) });
  }
  return storage;
}

export const selfHostedStore = () => selfHostedStorage().store;

/** Without VD_SECRET_KEY, channel credentials are sealed with a random key kept next to the database. */
function keyFile(dir: string): Buffer {
  const file = path.join(dir, 'secret.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
  return readFileSync(file);
}
