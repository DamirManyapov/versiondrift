// Microsoft Security Update Guide API (api.msrc.microsoft.com/sug): every CVE names, per product, the build that
// fixes it, so ranges are exact ("10.0.20348.0" up to "10.0.20348.5622"). Microsoft publishes hundreds of CVEs a
// month per Windows version; only those that can make a status critical are kept: rated Critical by Microsoft, or
// exploited in the wild, released within the last `months` months.
import type { SecuritySource } from '@versiondrift/schema';
import type { AdapterContext } from '../types.ts';
import { toIso, type SourceType } from '../sources/common.ts';
import { severityFromScore, type AffectedRange, type RawAdvisory, type Severity } from './types.ts';

type MsrcSource = SourceType<SecuritySource, 'msrc'>;

const API = 'https://api.msrc.microsoft.com/sug/v2.0/en-US';
const DEFAULT_MONTHS = 6;
/** CVE ids per title lookup, so the OData filter stays a reasonable URL. */
const BATCH = 20;

interface Page<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

interface AffectedProduct {
  cveNumber: string;
  product: string;
  releaseDate: string;
  severity?: string | null;
  impact?: string | null;
  baseProductVersion?: string | null;
  baseScore?: string | null;
  vectorString?: string | null;
  kbArticles?: { downloadName?: string | null; fixedBuildNumber?: string | null }[] | null;
}

interface Vulnerability {
  cveNumber: string;
  cveTitle?: string | null;
}

const RATING: Record<string, Severity> = {
  critical: 'critical',
  important: 'high',
  moderate: 'medium',
  low: 'low',
};

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const query = (entity: string, filter: string) => `${API}/${entity}?$filter=${encodeURIComponent(filter)}`;

async function all<T>(url: string, ctx: Pick<AdapterContext, 'fetcher'>): Promise<T[]> {
  const out: T[] = [];
  for (let next: string | undefined = url; next !== undefined;) {
    const page: Page<T> = await ctx.fetcher.json<Page<T>>(next, { headers: { accept: 'application/json' } });
    out.push(...page.value);
    next = page['@odata.nextLink'];
  }
  return out;
}

/** The regular security update's build: hotpatch builds belong to another line of builds. */
function fixedBuild(entry: AffectedProduct): string | undefined {
  const builds = (entry.kbArticles ?? []).filter((kb) => kb.fixedBuildNumber);
  return (
    (builds.find((kb) => kb.downloadName === 'Security Update') ?? builds[0])?.fixedBuildNumber ?? undefined
  );
}

export async function msrcAdvisories(source: MsrcSource, ctx: AdapterContext): Promise<RawAdvisory[]> {
  const since = new Date(ctx.now ?? Date.now());
  since.setUTCMonth(since.getUTCMonth() - (source.months ?? DEFAULT_MONTHS));
  const recent = `releaseDate gt ${since.toISOString().slice(0, 10)}T00:00:00+00:00`;

  const exploited = await all<Vulnerability>(query('vulnerability', `exploited eq 'Yes' and ${recent}`), ctx);
  const wanted = ["severity eq 'Critical'", ...exploited.map((v) => `cveNumber eq ${quote(v.cveNumber)}`)];
  const entries: AffectedProduct[] = [];
  for (const product of source.products) {
    const filter = `product eq ${quote(product)} and ${recent} and (${wanted.join(' or ')})`;
    entries.push(...(await all<AffectedProduct>(query('affectedProduct', filter), ctx)));
  }

  const byCve = new Map<string, AffectedProduct[]>();
  for (const entry of entries) byCve.set(entry.cveNumber, [...(byCve.get(entry.cveNumber) ?? []), entry]);
  const ids = [...byCve.keys()];
  const titles = new Map(exploited.map((v) => [v.cveNumber, v.cveTitle ?? '']));
  const untitled = ids.filter((id) => !titles.get(id));
  for (let i = 0; i < untitled.length; i += BATCH) {
    const batch = untitled.slice(i, i + BATCH).map((id) => `cveNumber eq ${quote(id)}`);
    for (const v of await all<Vulnerability>(query('vulnerability', batch.join(' or ')), ctx))
      titles.set(v.cveNumber, v.cveTitle ?? '');
  }

  const out: RawAdvisory[] = [];
  for (const [id, list] of byCve) {
    const affected: AffectedRange[] = [];
    const seen = new Set<string>();
    for (const entry of list) {
      const fixed = fixedBuild(entry);
      if (!fixed) continue;
      const introduced = entry.baseProductVersion || fixed.replace(/\d+$/, '0');
      const key = `${introduced} ${fixed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      affected.push({ introduced, fixed });
    }
    const scored = list
      .map((e) => ({ score: Number(e.baseScore), vector: e.vectorString ?? '' }))
      .filter((s) => Number.isFinite(s.score) && s.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    const rating = RATING[(list[0]?.severity ?? '').toLowerCase()] ?? 'unknown';
    const published = list
      .map((e) => toIso(e.releaseDate))
      .filter((d) => d !== undefined)
      .sort()[0];
    out.push({
      id,
      aliases: [],
      title: titles.get(id) || (list[0]?.impact ?? ''),
      cvss: scored
        ? {
            score: scored.score,
            vector: scored.vector,
            version: /^CVSS:(\d\.\d)/.exec(scored.vector)?.[1] ?? '3.1',
          }
        : null,
      severity: severityFromScore(scored?.score, rating),
      kev: false,
      published: published ?? null,
      affected,
      source: 'vendor',
      url: `https://msrc.microsoft.com/update-guide/vulnerability/${id}`,
    });
  }
  return out.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));
}
