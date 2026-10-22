import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The account page moved into Settings (docs/06); old links and bookmarks still work. */
export const GET: RequestHandler = () => redirect(308, '/settings/account');
