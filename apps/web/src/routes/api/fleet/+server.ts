import { json } from '$lib/server/api';
import { nextPollAt, pollIntervalHours } from '$lib/server/poller';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * The whole fleet in one answer (docs/specs/fleet-ui-tasks.md "Plan"): sites, access profiles without secrets,
 * hosts with their poll state and products, and per site the products followed without a host (added from the
 * catalog, like on the public site). The board, the hosts table and the phone view compute from it.
 */
export const GET: RequestHandler = () => {
  const { store, fleet } = selfHostedStorage();
  store.defaultBoard();
  const sites = store.boards();
  return json({
    sites,
    hostless: sites
      .map((s) => ({ siteId: s.id, items: store.items(s.id) ?? [] }))
      .filter((s) => s.items.length > 0),
    profiles: fleet.profiles(),
    hosts: fleet.hosts(),
    schedule: { intervalHours: pollIntervalHours(), next: nextPollAt() },
  });
};
