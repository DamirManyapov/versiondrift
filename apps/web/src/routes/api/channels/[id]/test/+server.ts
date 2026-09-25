import { error } from '@sveltejs/kit';
import { sendTest } from '$lib/server/alerts';
import { noContent } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** Sends a test message through the channel; the delivery error comes back as the 400 message. */
export const POST: RequestHandler = async ({ params }) => {
  const record = selfHostedStorage().channels.get(Number(params.id));
  if (!record) error(404, 'Unknown channel');
  try {
    await sendTest(record);
  } catch (e) {
    error(400, (e as Error).message);
  }
  return noContent();
};
