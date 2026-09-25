import { error, redirect } from '@sveltejs/kit';
import { authMode, safeNext, startSession } from '$lib/server/auth';
import { completeSignIn } from '$lib/server/oidc';
import { mode, selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url, request }) => {
  if (mode() !== 'selfhosted' || authMode() !== 'oidc') error(404, 'Not found');
  let result;
  try {
    result = await completeSignIn(cookies, url);
  } catch (e) {
    error(400, `Sign-in failed: ${(e as Error).message}`);
  }
  const user = selfHostedStorage().auth.findOrCreateExternal({
    key: 'oidc',
    subject: result.identity.subject,
    name: result.identity.name,
    ...(result.identity.email && { email: result.identity.email }),
  });
  startSession(cookies, request, user);
  redirect(303, safeNext(result.next));
};
