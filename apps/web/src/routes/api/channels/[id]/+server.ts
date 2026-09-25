import { error } from '@sveltejs/kit';
import { attempt, body, json, noContent } from '$lib/server/api';
import { parsePatch, redact } from '$lib/server/channels';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

function channelOf(param: string) {
  const { channels } = selfHostedStorage();
  const record = channels.get(Number(param));
  if (!record) error(404, 'Unknown channel');
  return { channels, record };
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const { channels, record } = channelOf(params.id);
  const patch = parsePatch(await body(request), record);
  return json(redact(attempt(() => channels.update(record.id, patch))));
};

export const DELETE: RequestHandler = ({ params }) => {
  const { channels, record } = channelOf(params.id);
  attempt(() => channels.remove(record.id));
  return noContent();
};
