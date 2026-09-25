// CISA Known Exploited Vulnerabilities: fetched once per run, used only to flag advisories (kev: true).
import type { Fetcher } from '../http/fetcher.ts';

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export async function fetchKev(fetcher: Fetcher): Promise<Set<string>> {
  const data = await fetcher.json<{ vulnerabilities?: { cveID: string }[] }>(KEV_URL);
  return new Set((data.vulnerabilities ?? []).map((v) => v.cveID.toUpperCase()));
}
