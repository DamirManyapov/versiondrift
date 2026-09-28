import { error } from '@sveltejs/kit';
import { body, json } from '$lib/server/api';
import { testProfile } from '$lib/server/poller';
import type { RequestHandler } from './$types';

/** Tries the profile on one host without saving anything: `{ hostId }` → what the detector found, or why not. */
export const POST: RequestHandler = async ({ params, request }) => {
  const profileId = Number(params.id);
  const input = (await body(request)) as { hostId?: unknown };
  if (!Number.isInteger(profileId) || typeof input.hostId !== 'number') error(400, 'hostId is required');
  return json(await testProfile(profileId, input.hostId));
};
