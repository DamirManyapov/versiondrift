// GitHub Security Advisories: repository advisories (REST) or the global database for a package.
import type { SecuritySource } from '@versiondrift/schema';
import type { AdapterContext } from '../types.ts';
import { toIso, type SourceType } from '../sources/common.ts';
import { normalizeSeverity, parseRangeExpression, severityFromScore, type RawAdvisory } from './types.ts';

type GhsaSource = SourceType<SecuritySource, 'ghsa'>;

interface GhAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: string | null;
  cvss?: { score: number | null; vector_string: string | null } | null;
  cvss_severities?: { cvss_v3?: { score: number | null; vector_string: string | null } | null } | null;
  published_at: string | null;
  html_url: string;
  vulnerabilities:
    | {
        vulnerable_version_range: string | null;
        patched_versions: string | null;
        first_patched_version?: string | null;
      }[]
    | null;
}

const MAX_PAGES = 10;

export async function ghsaAdvisories(source: GhsaSource, ctx: AdapterContext): Promise<RawAdvisory[]> {
  const base = source.repo
    ? `https://api.github.com/repos/${source.repo}/security-advisories?state=published&sort=published&direction=desc&per_page=100`
    : `https://api.github.com/advisories?ecosystem=${encodeURIComponent(source.ecosystem ?? '')}&affects=${encodeURIComponent(source.package ?? '')}&per_page=100`;
  const out: RawAdvisory[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await ctx.fetcher.json<GhAdvisory[]>(`${base}&page=${page}`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    for (const a of list) {
      const cvss = a.cvss_severities?.cvss_v3 ?? a.cvss ?? null;
      const score = cvss?.score ?? null;
      const affected = (a.vulnerabilities ?? []).flatMap((v) =>
        v.vulnerable_version_range
          ? parseRangeExpression(
              v.vulnerable_version_range,
              v.first_patched_version ?? v.patched_versions ?? undefined,
            )
          : [],
      );
      out.push({
        id: a.cve_id ?? a.ghsa_id,
        aliases: a.cve_id ? [a.ghsa_id] : [],
        title: a.summary.trim(),
        cvss:
          score !== null
            ? {
                score,
                vector: cvss?.vector_string ?? '',
                version: cvss?.vector_string?.startsWith('CVSS:3.0') ? '3.0' : '3.1',
              }
            : null,
        severity: severityFromScore(score, normalizeSeverity(a.severity)),
        kev: false,
        published: toIso(a.published_at) ?? null,
        affected,
        source: 'ghsa',
        url: a.html_url,
      });
    }
    if (list.length < 100) break;
  }
  return out;
}
