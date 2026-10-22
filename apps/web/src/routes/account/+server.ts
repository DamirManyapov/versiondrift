import { error, redirect } from '@sveltejs/kit';
import { mode } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** The account page moved into Settings (docs/06); old links and bookmarks still work. The public site has none. */
export const GET: RequestHandler = () => {
  if (mode() !== 'selfhosted') error(404, 'Not found');
  redirect(308, '/settings/account');
};
