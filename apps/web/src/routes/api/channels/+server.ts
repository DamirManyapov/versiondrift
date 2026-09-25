import { attempt, body, json } from '$lib/server/api';
import { parseNew, redact } from '$lib/server/channels';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ channels: selfHostedStorage().channels.list().map(redact) });

export const POST: RequestHandler = async ({ request }) => {
  const { channels } = selfHostedStorage();
  const input = parseNew(await body(request));
  return json(redact(attempt(() => channels.create(input))), { status: 201 });
};
