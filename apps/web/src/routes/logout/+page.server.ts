import { redirect } from '@sveltejs/kit';
import { endSession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

// Signing out is a POST (a form in the header); a plain visit just goes home.
export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
  default: ({ cookies }) => {
    endSession(cookies);
    redirect(303, '/login');
  },
};
