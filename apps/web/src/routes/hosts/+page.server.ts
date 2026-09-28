import { error } from '@sveltejs/kit';
import { mode } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

// Fleet screens exist only in self-hosted mode; the data loads in the browser from /api/fleet.
export const load: PageServerLoad = () => {
  if (mode() !== 'selfhosted') error(404, 'Not found');
};
