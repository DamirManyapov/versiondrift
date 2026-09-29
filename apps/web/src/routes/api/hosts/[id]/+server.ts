import { error } from '@sveltejs/kit';
import { attempt, body, json } from '$lib/server/api';
import { startPoll } from '$lib/server/poller';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const hostId = (param: string) => {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) error(404, 'Unknown host');
  return id;
};

/** One host with its products and history, newest first. */
export const GET: RequestHandler = ({ params }) => {
  const host = selfHostedStorage().fleet.host(hostId(params.id));
  if (!host) error(404, 'Unknown host');
  return json(host);
};

/**
 * Edits a host from its card: `{ address?, siteId?, profileId? }` (the address may carry the port, "10.0.0.5:2026";
 * profileId null clears the profile). A new address or profile is checked at once; the answer carries that job.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = hostId(params.id);
  const { fleet } = selfHostedStorage();
  const before = fleet.host(id);
  if (!before) error(404, 'Unknown host');
  const input = (await body(request)) as Record<string, unknown>;
  attempt(() => {
    if (typeof input.address === 'string') fleet.setAddress(id, input.address);
    if (typeof input.siteId === 'number' && input.siteId !== before.siteId)
      fleet.moveHosts([id], input.siteId);
    if (input.profileId === null || typeof input.profileId === 'number')
      if (input.profileId !== before.profileId) fleet.setProfile([id], input.profileId);
  });
  const host = fleet.host(id)!;
  const recheck =
    host.profileId !== null &&
    (host.address !== before.address || host.port !== before.port || host.profileId !== before.profileId);
  const job = recheck ? startPoll([id]) : undefined;
  return json({ host, ...(job && { job }) });
};
