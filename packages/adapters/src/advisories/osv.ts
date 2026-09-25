// OSV.dev (https://osv.dev/docs/): advisories for a package in an ecosystem, with OSV ranges as they are.
import type { SecuritySource } from '@versiondrift/schema';
import type { AdapterContext } from '../types.ts';
import { toIso, type SourceType } from '../sources/common.ts';
import { normalizeSeverity, type AffectedRange, type RawAdvisory } from './types.ts';

type OsvSource = SourceType<SecuritySource, 'osv'>;

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  published?: string;
  database_specific?: { severity?: string };
  affected?: {
    package?: { name: string; ecosystem: string };
    ranges?: { type: string; events: { introduced?: string; fixed?: string; last_affected?: string }[] }[];
  }[];
}

export async function osvAdvisories(source: OsvSource, ctx: AdapterContext): Promise<RawAdvisory[]> {
  const data = await ctx.fetcher.json<{ vulns?: OsvVuln[] }>('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { ecosystem: source.ecosystem, name: source.package } }),
  });
  return (data.vulns ?? []).map((v) => {
    const affected: AffectedRange[] = [];
    for (const a of v.affected ?? []) {
      if (a.package && a.package.name !== source.package) continue;
      for (const range of a.ranges ?? []) {
        if (range.type === 'GIT') continue;
        let current: AffectedRange = {};
        for (const event of range.events) {
          if (event.introduced !== undefined) current = { introduced: event.introduced };
          if (event.fixed !== undefined) {
            affected.push({ ...current, fixed: event.fixed });
            current = {};
          }
          if (event.last_affected !== undefined) {
            affected.push({ ...current, last_affected: event.last_affected });
            current = {};
          }
        }
        if (current.introduced !== undefined) affected.push(current);
      }
    }
    const cve = v.aliases?.find((a) => a.startsWith('CVE-'));
    return {
      id: cve ?? v.id,
      aliases: [...new Set([v.id, ...(v.aliases ?? [])])].filter((a) => a !== (cve ?? v.id)),
      title: (v.summary ?? v.details ?? '').slice(0, 200),
      cvss: null,
      severity: normalizeSeverity(v.database_specific?.severity),
      kev: false,
      published: toIso(v.published) ?? null,
      affected,
      source: 'osv',
      url: `https://osv.dev/vulnerability/${v.id}`,
    };
  });
}
