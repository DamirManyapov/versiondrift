import { error } from '@sveltejs/kit';
import { json } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** One host with its products and history, newest first. */
export const GET: RequestHandler = ({ params }) => {
  const id = Number(params.id);
  const host = Number.isInteger(id) && id > 0 ? selfHostedStorage().fleet.host(id) : undefined;
  if (!host) error(404, 'Unknown host');
  return json(host);
};
