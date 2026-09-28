// The self-hosted fleet API (docs/specs/fleet-ui.md §6, routes under /api/fleet and /api/hosts).
import type { AccessProfile, HostEvent, HostRecord } from '@versiondrift/db';

export type { AccessProfile, HostEvent, HostRecord };

export interface FleetData {
  sites: { id: number; name: string }[];
  profiles: AccessProfile[];
  hosts: HostRecord[];
  schedule: { intervalHours: number; next: string | null };
}

export interface PollJob {
  id: string;
  total: number;
  done: number;
  results: { hostId: number; name: string; state: string; changed: boolean }[];
  finished: boolean;
}

async function get<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function post<T>(url: string, data: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const fleetApi = {
  poll: (ids?: number[]) => post<PollJob>('/api/hosts/poll', ids ? { ids } : {}),
  job: (id: string) => get<PollJob>(fetch, `/api/poll/jobs/${encodeURIComponent(id)}`),
  fleet: (fetcher: typeof fetch = fetch) => get<FleetData>(fetcher, '/api/fleet'),
  host: (id: number, fetcher: typeof fetch = fetch) =>
    get<HostRecord & { events: HostEvent[] }>(fetcher, `/api/hosts/${id}`),
};
