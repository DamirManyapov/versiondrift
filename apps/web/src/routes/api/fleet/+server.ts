import { json } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * The whole fleet in one answer (docs/specs/fleet-ui-tasks.md "Plan"): sites, access profiles without secrets, and
 * hosts with their poll state and products. The board, the hosts table and the phone view compute from it.
 */
export const GET: RequestHandler = () => {
  const { store, fleet } = selfHostedStorage();
  store.defaultBoard();
  return json({ sites: store.boards(), profiles: fleet.profiles(), hosts: fleet.hosts() });
};
