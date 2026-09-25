import { feedSyncState } from '$lib/server/feed-sync';
import { mode } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

/** Self-hosted: how the local feed mirror is doing (docs/07 "Feed sync"). */
export const load: PageServerLoad = async () => ({
  mirror: mode() === 'selfhosted' ? await feedSyncState() : null,
});
