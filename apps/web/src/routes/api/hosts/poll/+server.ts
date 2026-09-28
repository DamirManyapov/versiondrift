import { error } from '@sveltejs/kit';
import { body, json } from '$lib/server/api';
import { startPoll } from '$lib/server/poller';
import type { RequestHandler } from './$types';

/** Poll now: `{ ids: [1, 2] }`, or `{}` for every host with an access profile. Answers with the job to follow. */
export const POST: RequestHandler = async ({ request }) => {
  const input = (await body(request)) as { ids?: unknown };
  const ids = input.ids;
  if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => Number.isInteger(id))))
    error(400, 'ids must be a list of host ids');
  return json(startPoll(ids as number[] | undefined), { status: 202 });
};
