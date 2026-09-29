import { error } from '@sveltejs/kit';
import { attempt, body, json } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * A product typed by hand on a host: `{ productId, version, track? }` (software the detectors can't see, such as a
 * container). A product already typed on the host gets the new version. Answers the host.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number(params.id);
  const { fleet } = selfHostedStorage();
  if (!Number.isInteger(id) || !fleet.host(id)) error(404, 'Unknown host');
  const input = (await body(request)) as Record<string, unknown>;
  const text = (key: string) => (typeof input[key] === 'string' ? input[key] : '');
  attempt(() => fleet.setManual(id, text('productId'), text('version'), text('track') || undefined));
  return json(fleet.host(id), { status: 201 });
};
