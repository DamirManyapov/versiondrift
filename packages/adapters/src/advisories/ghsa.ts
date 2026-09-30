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
  cvss_severities?: {
    cvss_v3?: { score: number | null; vector_string: string | null } | null;
    cvss_v4?: { score: number | null; vector_string: string | null } | null;
  } | null;
  published_at: string | null;
  html_url: string;
  vulnerabilities:
    | {
        package?: { ecosystem: string; name: string } | null;
        vulnerable_version_range: string | null;
        patched_versions: string | null;
        first_patched_version?: string | null;
      }[]
    | null;
}

const MAX_PAGES = 10;

/** The rel="next" URL of a Link header: GitHub pages advisories by cursor (`after=`) and ignores `page=`. */
export function nextLink(header: string | undefined): string | undefined {
  return header
    ?.split(',')
    .map((part) => /<([^>]+)>\s*;\s*rel="next"/.exec(part)?.[1])
    .find((url) => url !== undefined);
}

/** CVSS 3.x when there is one, else 4.0 (some projects score in 4.0 only), as NVD prefers them. */
function pickCvss(a: GhAdvisory): { score: number; vector: string } | undefined {
  for (const c of [a.cvss_severities?.cvss_v3, a.cvss, a.cvss_severities?.cvss_v4])
    if (c?.score !== null && c?.score !== undefined) return { score: c.score, vector: c.vector_string ?? '' };
  return undefined;
}

export async function ghsaAdvisories(source: GhsaSource, ctx: AdapterContext): Promise<RawAdvisory[]> {
  const base = source.repo
    ? `https://api.github.com/repos/${source.repo}/security-advisories?state=published&sort=published&direction=desc&per_page=100`
    : `https://api.github.com/advisories?ecosystem=${encodeURIComponent(source.ecosystem ?? '')}&affects=${encodeURIComponent(source.package ?? '')}&per_page=100`;
  const out: RawAdvisory[] = [];
  // The first page keeps "&page=1" (and its recorded fixtures); later pages follow the Link header's cursor.
  let url: string | undefined = `${base}&page=1`;
  for (let page = 0; url !== undefined && page < MAX_PAGES; page++) {
    const response = await ctx.fetcher.text(url, { headers: { accept: 'application/vnd.github+json' } });
    const list = JSON.parse(response.body) as GhAdvisory[];
    url = list.length === 100 ? nextLink(response.headers.link) : undefined;
    for (const a of list) {
      const cvss = pickCvss(a);
      const score = cvss?.score ?? null;
      // An advisory in the global database may name several packages: only this package's ranges count.
      const vulnerabilities = (a.vulnerabilities ?? []).filter(
        (v) => !source.package || !v.package || v.package.name === source.package,
      );
      const affected = vulnerabilities.flatMap((v) =>
        v.vulnerable_version_range
          ? parseRangeExpression(
              v.vulnerable_version_range,
              v.first_patched_version || v.patched_versions || undefined,
            )
          : [],
      );
      // Repository advisories may carry "" instead of null when no CVE was assigned (Mailu GHSA-3h96-x359-qrwm).
      const cve = a.cve_id?.trim() || undefined;
      out.push({
        id: cve ?? a.ghsa_id,
        aliases: cve ? [a.ghsa_id] : [],
        title: a.summary.trim(),
        cvss: cvss
          ? {
              score: cvss.score,
              vector: cvss.vector,
              version: cvss.vector.startsWith('CVSS:4.0')
                ? '4.0'
                : cvss.vector.startsWith('CVSS:3.0')
                  ? '3.0'
                  : '3.1',
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
  }
  return out;
}
