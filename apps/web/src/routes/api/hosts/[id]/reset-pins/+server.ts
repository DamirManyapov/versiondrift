import { error } from '@sveltejs/kit';
import { attempt, noContent } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** Trusts a new host key or certificate (the host was reinstalled): the next poll pins what it sees. */
export const POST: RequestHandler = ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) error(404, 'Unknown host');
  attempt(() => selfHostedStorage().fleet.resetPins(id));
  return noContent();
};
