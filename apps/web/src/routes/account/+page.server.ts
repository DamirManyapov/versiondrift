import { error, fail } from '@sveltejs/kit';
import { StoreError } from '@versiondrift/db';
import { authMode, field, startSession } from '$lib/server/auth';
import { mode, selfHostedStorage } from '$lib/server/storage';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (mode() !== 'selfhosted' || !locals.user) error(404, 'Not found');
  return {
    user: { name: locals.user.name, email: locals.user.email, role: locals.user.role },
    method: authMode(),
  };
};

export const actions: Actions = {
  password: async ({ request, locals, cookies }) => {
    if (mode() !== 'selfhosted' || authMode() !== 'password' || !locals.user) error(404, 'Not found');
    const form = await request.formData();
    const current = field(form, 'current');
    const next = field(form, 'next');
    const { auth } = selfHostedStorage();
    if (!(await auth.checkPassword(locals.user.name, current)))
      return fail(400, { problem: 'wrongPassword' as const });
    if (next !== field(form, 'repeat')) return fail(400, { problem: 'mismatch' as const });
    try {
      await auth.setPassword(locals.user.id, next);
    } catch (e) {
      if (e instanceof StoreError) return fail(400, { problem: 'tooShort' as const });
      throw e;
    }
    // Other devices are signed out; this one gets a fresh session.
    auth.deleteSessionsOf(locals.user.id);
    startSession(cookies, request, locals.user);
    return { changed: true };
  },
};
