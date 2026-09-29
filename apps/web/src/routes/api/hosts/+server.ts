import { error } from '@sveltejs/kit';
import { attempt, body, json, noContent } from '$lib/server/api';
import { startPoll } from '$lib/server/poller';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const KINDS = ['ssh-linux', 'windows', 'routeros', 'proxmox'] as const;

/**
 * Adds one host: `{ name, address, siteId, profileId? , kind?, port? }` (the kind comes from the profile, or is given for
 * a host without one; the address may carry the port, "10.0.0.5:2026"). A host with a profile is polled at once; the
 * answer carries that job.
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
    fleet.createHost({
      name: text('name'),
      address: text('address'),
      siteId,
      kind,
      profileId,
      ...(typeof input.port === 'number' && { port: input.port }),
    }),
  );
  const job = profileId === null ? undefined : startPoll([host.id]);
  return json({ host, ...(job && { job }) }, { status: 201 });
};

/** Deletes hosts `{ ids }` with the versions found on them and their history. */
export const DELETE: RequestHandler = async ({ request }) => {
  const { fleet } = selfHostedStorage();
  const { ids } = (await body(request)) as { ids?: unknown };
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id)))
    error(400, 'Expected { ids: [host ids] }');
  fleet.deleteHosts(ids as number[]);
  return noContent();
};
