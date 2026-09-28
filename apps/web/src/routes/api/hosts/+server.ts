import { error } from '@sveltejs/kit';
import { attempt, body, json } from '$lib/server/api';
import { startPoll } from '$lib/server/poller';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const KINDS = ['ssh-linux', 'windows', 'routeros', 'proxmox'] as const;

/**
 * Adds one host: `{ name, address, siteId, profileId? , kind? }` (the kind comes from the profile, or is given for a
 * host without one). A host with a profile is polled at once; the answer carries that job.
 */
export const POST: RequestHandler = async ({ request }) => {
  const { store, fleet } = selfHostedStorage();
  const input = (await body(request)) as Record<string, unknown>;
  const text = (key: string) => (typeof input[key] === 'string' ? input[key] : '');
  const profileId = typeof input.profileId === 'number' ? input.profileId : null;
  const profile = profileId === null ? undefined : fleet.profiles().find((p) => p.id === profileId);
  if (profileId !== null && !profile) error(400, `no access profile ${profileId}`);
  const kind = profile?.kind ?? KINDS.find((k) => k === input.kind);
  if (!kind) error(400, `a host without a profile needs a type: ${KINDS.join(', ')}`);
  const siteId = typeof input.siteId === 'number' ? input.siteId : store.defaultBoard().id;
  const host = attempt(() =>
    fleet.createHost({ name: text('name'), address: text('address'), siteId, kind, profileId }),
  );
  const job = profileId === null ? undefined : startPoll([host.id]);
  return json({ host, ...(job && { job }) }, { status: 201 });
};
