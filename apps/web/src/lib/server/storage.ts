// Self-hosted mode (VD_MODE=selfhosted, docs/07): boards live in SQLite under VD_DATA_DIR. The public site keeps
// the inventory in the browser and never opens a database.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { openStorage, type Storage } from '@versiondrift/db';
import { env } from '$env/dynamic/private';

export type Mode = 'public' | 'selfhosted';

export const mode = (): Mode => (env.VD_MODE === 'selfhosted' ? 'selfhosted' : 'public');

let storage: Storage | undefined;

/** The store, opened (and migrated) on first use; 404 outside self-hosted mode so the API doesn't exist there. */
export function selfHostedStore() {
  if (mode() !== 'selfhosted') error(404, 'Not found');
  if (!storage) {
    const dir = path.resolve(env.VD_DATA_DIR || './data');
    mkdirSync(dir, { recursive: true });
    storage = openStorage(path.join(dir, 'versiondrift.db'));
  }
  return storage.store;
}
