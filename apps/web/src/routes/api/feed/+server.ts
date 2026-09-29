import { feedSource, feedSyncState, importDir } from '$lib/server/feed-sync';
import { json } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** Settings → Feed: the local copy, where it comes from (null: no network, packages only), the import folder. */
export const GET: RequestHandler = async () => {
  selfHostedStorage();
  return json({ state: await feedSyncState(), source: feedSource(), importDir: importDir() });
};
