// NVD CVE API 2.0 by CPE prefix: CVSS scores and version ranges from the CVE configurations.
import type { SecuritySource } from '@versiondrift/schema';
import type { AdapterContext } from '../types.ts';
import { toIso, type SourceType } from '../sources/common.ts';
import { severityFromScore, type AffectedRange, type RawAdvisory } from './types.ts';

type NvdSource = SourceType<SecuritySource, 'nvd'>;

interface CpeMatch {
  vulnerable: boolean;
  criteria: string;
  versionStartIncluding?: string;
  versionStartExcluding?: string;
  versionEndIncluding?: string;
  versionEndExcluding?: string;
}

interface CvssMetric {
  cvssData: { baseScore: number; vectorString: string; version: string };
}

interface NvdCve {
  id: string;
  published: string;
  descriptions: { lang: string; value: string }[];
  metrics?: Record<string, CvssMetric[] | undefined>;
  configurations?: { nodes: { cpeMatch?: CpeMatch[] }[] }[];
}

interface NvdPage {
  totalResults: number;
  resultsPerPage: number;
  vulnerabilities: { cve: NvdCve }[];
}

const PAGE = 2000;
const METRIC_PREFERENCE = ['cvssMetricV31', 'cvssMetricV30', 'cvssMetricV40', 'cvssMetricV2'];

/** "cpe:2.3:a:grafana:grafana" → vendor:product part, to recognise the product's own CPE matches. */
function productOf(cpe: string): string {
  return cpe.split(':').slice(2, 5).join(':');
}

/** NVD sometimes puts dates where versions belong ("RouterOS through 2021-01-04"); such bounds are unusable. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function rangesFromConfigurations(cve: NvdCve, cpe: string): AffectedRange[] {
  const wanted = productOf(cpe);
  const ranges: AffectedRange[] = [];
  for (const config of cve.configurations ?? []) {
    for (const node of config.nodes) {
      for (const m of node.cpeMatch ?? []) {
        if (!m.vulnerable || productOf(m.criteria) !== wanted) continue;
        const exact = m.criteria.split(':')[5];
        const bounds = [
          m.versionStartIncluding,
          m.versionStartExcluding,
          m.versionEndIncluding,
          m.versionEndExcluding,
        ];
        if (bounds.some((b) => b !== undefined && DATE.test(b))) continue;
        const hasBounds =
          m.versionStartIncluding ??
          m.versionStartExcluding ??
          m.versionEndIncluding ??
          m.versionEndExcluding;
        if (!hasBounds && exact && exact !== '*' && exact !== '-') {
          ranges.push({ introduced: exact, last_affected: exact });
        } else if (hasBounds) {
          ranges.push({
            introduced: m.versionStartIncluding ?? m.versionStartExcluding ?? '0',
            ...(m.versionEndExcluding && { fixed: m.versionEndExcluding }),
            ...(m.versionEndIncluding && { last_affected: m.versionEndIncluding }),
          });
        }
      }
    }
  }
  // Editions share the product part (GitLab CE/EE), so the same range often appears more than once.
  const seen = new Set<string>();
  return ranges.filter((r) => {
    const key = JSON.stringify(r);
    return !seen.has(key) && Boolean(seen.add(key));
  });
}

export async function nvdAdvisories(source: NvdSource, ctx: AdapterContext): Promise<RawAdvisory[]> {
  const out: RawAdvisory[] = [];
  for (let start = 0; ; start += PAGE) {
    const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=${encodeURIComponent(source.cpe)}&resultsPerPage=${PAGE}&startIndex=${start}`;
    const page = await ctx.fetcher.json<NvdPage>(url);
    for (const { cve } of page.vulnerabilities) {
      const metric = METRIC_PREFERENCE.map((k) => cve.metrics?.[k]?.[0]).find((m) => m !== undefined);
      const score = metric?.cvssData.baseScore;
      const description = cve.descriptions.find((d) => d.lang === 'en')?.value ?? '';
      out.push({
        id: cve.id,
        aliases: [],
        title: description.length > 200 ? `${description.slice(0, 197).trimEnd()}…` : description,
        cvss: metric
          ? {
              score: metric.cvssData.baseScore,
              vector: metric.cvssData.vectorString,
              version: metric.cvssData.version,
            }
          : null,
        severity: severityFromScore(score),
        kev: false,
        published: toIso(`${cve.published}Z`) ?? null,
        affected: rangesFromConfigurations(cve, source.cpe),
        source: 'nvd',
        url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      });
    }
    if (start + PAGE >= page.totalResults) break;
  }
  return out;
}
