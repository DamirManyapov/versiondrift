import { error } from '@sveltejs/kit';
import { attempt, body, noContent } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const id = (param: string) => {
  const n = Number(param);
  if (!Number.isInteger(n) || n <= 0) error(404, 'Unknown access profile');
  return n;
};

/** Replaces the secret: `{ secret }`. The old one is never shown. */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const input = (await body(request)) as { secret?: unknown };
  if (typeof input.secret !== 'string' || input.secret === '') error(400, 'secret is required');
  const secret = input.secret;
  attempt(() => selfHostedStorage().fleet.setProfileSecret(id(params.id), secret));
  return noContent();
};

/** Deletes the profile; its hosts keep their versions and wait for another profile. */
export const DELETE: RequestHandler = ({ params }) => {
  attempt(() => selfHostedStorage().fleet.deleteProfile(id(params.id)));
  return noContent();
};
