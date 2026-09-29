import { error } from '@sveltejs/kit';
import { noContent } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** Removes a product typed by hand on a host. */
export const DELETE: RequestHandler = ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || !selfHostedStorage().fleet.removeManual(id, params.productId))
    error(404, 'No such product typed on this host');
  return noContent();
};
