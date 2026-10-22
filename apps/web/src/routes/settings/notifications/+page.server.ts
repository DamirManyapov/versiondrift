import { error } from '@sveltejs/kit';
import { mode } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

/** Self-hosted, admins only, as before the split: viewers cannot change channels through the API either. */
export const load: PageServerLoad = ({ locals }) => {
  if (mode() !== 'selfhosted') error(404, 'Not found');
  if (locals.user?.role === 'viewer') error(403, 'Viewers cannot change notifications');
};
