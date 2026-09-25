import { error, fail, redirect } from '@sveltejs/kit';
import {
  authMode,
  field,
  recordFailure,
  safeNext,
  startSession,
  tooManyAttempts,
  trustedHeader,
} from '$lib/server/auth';
import { mode, selfHostedStorage } from '$lib/server/storage';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  if (mode() !== 'selfhosted') error(404, 'Not found');
  const next = safeNext(url.searchParams.get('next'));
  if (locals.user) redirect(303, next);
  return { method: authMode(), header: trustedHeader(), next };
};

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    if (mode() !== 'selfhosted' || authMode() !== 'password') error(404, 'Not found');
    const form = await request.formData();
    const name = field(form, 'name').trim();
    const password = field(form, 'password');
    const key = `${getClientAddress()}|${name.toLowerCase()}`;
    if (tooManyAttempts(key)) return fail(429, { name, problem: 'tooMany' as const });
    const user = await selfHostedStorage().auth.checkPassword(name, password);
    if (!user) {
      recordFailure(key);
      return fail(400, { name, problem: 'invalid' as const });
    }
    startSession(cookies, request, user);
    redirect(303, safeNext(url.searchParams.get('next')));
  },
};
