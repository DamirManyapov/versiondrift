// Polling the fleet (ADR-0007, S6-T2): every VD_DETECT_INTERVAL hours and on demand, a few hosts at a time, each
// through the detector of its kind with its access profile. Results go to the FleetStore (versions, poll state,
// history). Jobs are kept in memory so the UI can follow "Poll now" (GET /api/poll/jobs/:id).
import { Cron } from 'croner';
import type { FleetStore, HostRecord, PollResult } from '@versiondrift/db';
import { detect as detectHost } from '@versiondrift/detect';
import { env } from '$env/dynamic/private';
import { selfHostedStorage } from './storage';

export interface PollJob {
  id: string;
  total: number;
  done: number;
  results: { hostId: number; name: string; state: string; changed: boolean }[];
  finished: boolean;
}

type Detection =
  | {
      ok: true;
      found: Extract<PollResult, { ok: true }>['found'];
      pins?: Extract<PollResult, { ok: true }>['pins'];
    }
  | Omit<Extract<PollResult, { ok: false }>, 'at'>;

const jobs = new Map<string, PollJob>();
const CONCURRENCY = 8;
let schedule: Cron | undefined;

export const pollIntervalHours = (): number => {
  const hours = Number(env.VD_DETECT_INTERVAL || 6);
  return Number.isFinite(hours) && hours >= 1 ? Math.floor(hours) : 6;
};

export const nextPollAt = (): string | null => schedule?.nextRun()?.toISOString() ?? null;

/**
 * The detector of the host's kind with its profile's credentials (@versiondrift/detect). The demo (VD_DEMO=1)
 * answers from what the store already holds instead: hosts with a poll problem keep failing, the others report the
 * versions they have.
 */
function detect(host: HostRecord, profileId = host.profileId): Promise<Detection> {
  if (env.VD_DEMO === '1') {
    if (host.poll.state === 'auth-failed' || host.poll.state === 'unreachable')
      return Promise.resolve({
        ok: false,
        state: host.poll.state,
        code: host.poll.errorCode ?? 'timeout',
        message: host.poll.errorMessage ?? '',
      });
    return Promise.resolve({
      ok: true,
      found: host.instances
        .filter((i) => i.source === 'detected')
        .map((i) => ({
          productId: i.productId,
          version: i.version,
          ...(i.track && { track: i.track }),
          ...(i.label && { label: i.label }),
        })),
    });
  }
  if (profileId === null)
    return Promise.resolve({ ok: false, state: 'unknown', code: 'no_profile', message: 'No access profile' });
  const credentials = selfHostedStorage().fleet.profileCredentials(profileId);
  return detectHost(
    { name: host.name, address: host.address, port: host.port, kind: host.kind },
    credentials,
    host.pins,
  );
}

async function pollOne(fleet: FleetStore, host: HostRecord, job: PollJob): Promise<void> {
  const before = JSON.stringify(host.instances.map((i) => [i.productId, i.version]));
  let result: PollResult;
  try {
    const detection = await detect(host);
    result = { ...detection, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  } catch (error) {
    result = {
      ok: false,
      state: 'unreachable',
      code: 'error',
      message: (error as Error).message,
      at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
  }
  fleet.recordPoll(host.id, result);
  const after = fleet.host(host.id);
  job.results.push({
    hostId: host.id,
    name: host.name,
    state: after?.poll.state ?? 'unknown',
    changed: JSON.stringify(after?.instances.map((i) => [i.productId, i.version]) ?? []) !== before,
  });
  job.done++;
}

/** Polls these hosts (all with a profile when `ids` is absent); returns the job at once. */
export function startPoll(ids?: number[]): PollJob {
  const { fleet } = selfHostedStorage();
  const hosts = fleet
    .hosts()
    .filter((h) => h.profileId !== null && (ids === undefined || ids.includes(h.id)));
  const job: PollJob = {
    id: crypto.randomUUID(),
    total: hosts.length,
    done: 0,
    results: [],
    finished: false,
  };
  jobs.set(job.id, job);
  void (async () => {
    const queue = [...hosts];
    const worker = async () => {
      for (let host = queue.shift(); host; host = queue.shift()) await pollOne(fleet, host, job);
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    job.finished = true;
    // Finished jobs are kept for a while for the UI, then dropped.
    setTimeout(() => jobs.delete(job.id), 10 * 60_000).unref();
  })();
  return job;
}

export const pollJob = (id: string): PollJob | undefined => jobs.get(id);

/** "Test on a host" in the profile wizard: runs the detector with this profile, stores nothing. */
export async function testProfile(profileId: number, hostId: number): Promise<Detection> {
  const { fleet } = selfHostedStorage();
  const host = fleet.hosts().find((h) => h.id === hostId);
  const profile = fleet.profiles().find((p) => p.id === profileId);
  if (!host || !profile)
    return { ok: false, state: 'unknown', code: 'not_found', message: 'No such host or profile' };
  if (profile.kind !== host.kind)
    return {
      ok: false,
      state: 'unknown',
      code: 'wrong_kind',
      message: `Profile "${profile.name}" is for ${profile.kind} hosts, ${host.name} is ${host.kind}`,
    };
  try {
    return await detect(host, profileId);
  } catch (error) {
    return { ok: false, state: 'unreachable', code: 'error', message: (error as Error).message };
  }
}

/** Called once at server start in self-hosted mode. */
export function startPolling(): void {
  if (schedule) return;
  schedule = new Cron(
    `0 */${pollIntervalHours()} * * *`,
    { timezone: env.VD_TZ || env.TZ || 'UTC', protect: true },
    () => void startPoll(),
  );
}
