import { feedSyncState, syncNow } from '$lib/server/feed-sync';
import { json } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** "Check for updates": a sync now (the import folder, then the network unless VD_FEED_URL=off). */
export const POST: RequestHandler = async () => {
  selfHostedStorage();
  await syncNow();
  return json({ state: await feedSyncState() });
};
