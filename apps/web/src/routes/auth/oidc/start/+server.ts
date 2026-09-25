import { error, redirect } from '@sveltejs/kit';
import { authMode, isHttps, safeNext } from '$lib/server/auth';
import { authorizationUrl } from '$lib/server/oidc';
import { mode } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url, request }) => {
  if (mode() !== 'selfhosted' || authMode() !== 'oidc') error(404, 'Not found');
  const next = safeNext(url.searchParams.get('next'));
  const target = await authorizationUrl(cookies, url.origin, next, isHttps(request));
  redirect(303, target.toString());
};
