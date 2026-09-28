import { error } from '@sveltejs/kit';
import { json } from '$lib/server/api';
import { pollJob } from '$lib/server/poller';
import type { RequestHandler } from './$types';

/** Progress of a poll job: total, done, one result per host polled so far. */
export const GET: RequestHandler = ({ params }) => {
  const job = pollJob(params.id);
  if (!job) error(404, 'Unknown poll job');
  return json(job);
};
