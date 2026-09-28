// Self-hosted fleet data for the board, hosts and host pages; reloaded after changes. The selected site lives in
// the URL (?site=<id>) and is remembered in this browser.
import { fleetApi, type FleetData, type PollJob } from './api.ts';

const SITE_KEY = 'vd_site';

class FleetState {
  data = $state<FleetData | undefined>();
  error = $state<string | undefined>();
  loading = $state(false);

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.data = await fleetApi.fleet();
      this.error = undefined;
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  get hasHosts(): boolean {
    return (this.data?.hosts.length ?? 0) > 0;
  }
}

export const fleet = new FleetState();

/** The site from the URL, else the remembered one; undefined = all sites. */
export function siteFrom(url: URL, data: FleetData | undefined): number | undefined {
  const raw = url.searchParams.get('site') ?? rememberedSite();
  const id = Number(raw);
  return data?.sites.some((s) => s.id === id) ? id : undefined;
}

function rememberedSite(): string | null {
  try {
    return localStorage.getItem(SITE_KEY);
  } catch {
    return null;
  }
}

export function rememberSite(id: number | undefined): void {
  try {
    if (id === undefined) localStorage.removeItem(SITE_KEY);
    else localStorage.setItem(SITE_KEY, String(id));
  } catch {
    // only a convenience
  }
}

/** Follows a poll job (checking once a second) until it is done, then reloads the fleet. */
export async function followJob(start: PollJob, onProgress?: (job: PollJob) => void): Promise<PollJob> {
  let job = start;
  while (!job.finished) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    job = await fleetApi.job(job.id);
    onProgress?.(job);
  }
  await fleet.load();
  return job;
}

/** Polls hosts now and waits for the result. */
export const pollNow = async (ids?: number[]): Promise<PollJob> => followJob(await fleetApi.poll(ids));
