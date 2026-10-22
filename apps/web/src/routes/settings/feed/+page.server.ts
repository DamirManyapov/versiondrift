import { error } from '@sveltejs/kit';
import { mode } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

/** A self-hosted section of Settings; the public site has none. */
export const load: PageServerLoad = () => {
  if (mode() !== 'selfhosted') error(404, 'Not found');
};
