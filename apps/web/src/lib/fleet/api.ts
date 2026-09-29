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

export interface ImportPlanRow {
  line: number;
  name: string;
  address: string;
  site: string;
  profile: string;
  kind?: string;
  result: 'new' | 'unchanged' | 'update' | 'error';
  reason?: string;
  changes?: ('address' | 'site' | 'profile')[];
  newSite?: boolean;
}

async function postText<T>(url: string, text: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/csv', accept: 'application/json' },
    body: text,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function patch<T>(url: string, data: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function send(url: string, method: 'PATCH' | 'DELETE', data?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    ...(data !== undefined && { body: JSON.stringify(data) }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${url}: HTTP ${response.status}`);
  }
}

export type TestResult =
  | { ok: true; found: { productId: string; version: string | null }[] }
  | { ok: false; state: string; code: string; message: string };

export const fleetApi = {
  createProfile: (input: { name: string; kind: string; username: string; secret?: string }) =>
    post<AccessProfile>('/api/access-profiles', input),
  replaceSecret: (id: number, secret: string) => send(`/api/access-profiles/${id}`, 'PATCH', { secret }),
  deleteProfile: (id: number) => send(`/api/access-profiles/${id}`, 'DELETE'),
  testProfile: (id: number, hostId: number) =>
    post<TestResult>(`/api/access-profiles/${id}/test`, { hostId }),
  createHost: (input: {
    name: string;
    address: string;
    siteId: number;
    profileId: number | null;
    kind?: string;
  }) => post<{ host: HostRecord; job?: PollJob }>('/api/hosts', input),
  /** Address ("10.0.0.5:2026"), site or profile from the host card; a new address or profile is checked at once. */
  updateHost: (id: number, input: { address?: string; siteId?: number; profileId?: number | null }) =>
    patch<{ host: HostRecord; job?: PollJob }>(`/api/hosts/${id}`, input),
  deleteHosts: (ids: number[]) => send('/api/hosts', 'DELETE', { ids }),
  planImport: (csv: string) => postText<{ rows: ImportPlanRow[] }>('/api/hosts/import?dryRun=1', csv),
  runImport: (csv: string) =>
    postText<{ rows: ImportPlanRow[]; created: number; updated: number; job?: PollJob }>(
      '/api/hosts/import',
      csv,
    ),
  poll: (ids?: number[]) => post<PollJob>('/api/hosts/poll', ids ? { ids } : {}),
  job: (id: string) => get<PollJob>(fetch, `/api/poll/jobs/${encodeURIComponent(id)}`),
  fleet: (fetcher: typeof fetch = fetch) => get<FleetData>(fetcher, '/api/fleet'),
  host: (id: number, fetcher: typeof fetch = fetch) =>
    get<HostRecord & { events: HostEvent[] }>(fetcher, `/api/hosts/${id}`),
};
