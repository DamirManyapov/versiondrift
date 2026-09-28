// The self-hosted fleet API (docs/specs/fleet-ui.md §6, routes under /api/fleet and /api/hosts).
import type { AccessProfile, HostEvent, HostRecord } from '@versiondrift/db';

export type { AccessProfile, HostEvent, HostRecord };

export interface FleetData {
  sites: { id: number; name: string }[];
  profiles: AccessProfile[];
  hosts: HostRecord[];
}

async function get<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const fleetApi = {
  fleet: (fetcher: typeof fetch = fetch) => get<FleetData>(fetcher, '/api/fleet'),
  host: (id: number, fetcher: typeof fetch = fetch) =>
    get<HostRecord & { events: HostEvent[] }>(fetcher, `/api/hosts/${id}`),
};
