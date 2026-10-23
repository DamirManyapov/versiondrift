// docs/04 steps 7 and "Advisory → release linking": merge advisories from several sources, flag KEV, and give each
// fixing release a "Fixes CVE-…" item when the vendor's own notes don't mention it.
import { severityFromScore, type RawAdvisory } from '@versiondrift/adapters';
import { parse } from '@versiondrift/core';
import type { Advisory, ChangeItem, Module, Release, Severity } from '@versiondrift/schema';

const SOURCE_PRIORITY: Record<Advisory['source'], number> = { ghsa: 0, osv: 1, vendor: 2, debian: 3, nvd: 4 };
const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

export const maxSeverity = (list: Severity[]): Severity | null =>
  list.length === 0 ? null : list.reduce((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a));

const keysOf = (a: Pick<Advisory, 'id' | 'aliases'>) => [a.id, ...a.aliases].map((k) => k.toUpperCase());

/**
 * One advisory per vulnerability. The most precise source (GHSA, then OSV, then NVD) provides ranges when it has
 * them; CVSS comes from the first source that has a score; KEV comes from CISA's catalog.
 */
export function mergeAdvisories(lists: RawAdvisory[][], kev: ReadonlySet<string>): Advisory[] {
  const byKey = new Map<string, Advisory>();
  const merged: Advisory[] = [];
  const all = lists.flat().sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
  for (const incoming of all) {
    const existing = keysOf(incoming)
      .map((k) => byKey.get(k))
      .find((a) => a !== undefined);
    if (!existing) {
      const copy: Advisory = {
        ...incoming,
        aliases: [...incoming.aliases],
        affected: [...incoming.affected],
      };
      merged.push(copy);
      for (const k of keysOf(copy)) byKey.set(k, copy);
      continue;
    }
    // Prefer a CVE id as the primary id.
    const ids = new Set([existing.id, ...existing.aliases, incoming.id, ...incoming.aliases]);
    const cve = [...ids].find((id) => id.startsWith('CVE-'));
    if (cve && !existing.id.startsWith('CVE-')) existing.id = cve;
    existing.aliases = [...ids].filter((id) => id !== existing.id);
    if (existing.affected.length === 0) existing.affected = [...incoming.affected];
    existing.cvss ??= incoming.cvss;
    if (existing.cvss === null && SEVERITY_RANK[incoming.severity] > SEVERITY_RANK[existing.severity])
      existing.severity = incoming.severity;
    existing.title ||= incoming.title;
    if (incoming.published && (!existing.published || incoming.published < existing.published))
      existing.published = incoming.published;
    for (const k of keysOf(existing)) byKey.set(k, existing);
  }
  for (const a of merged) a.kev = keysOf(a).some((k) => kev.has(k));
  return merged.sort(
    (a, b) => (b.published ?? '').localeCompare(a.published ?? '') || a.id.localeCompare(b.id),
  );
}

/**
 * advisoryRanges: per-branch (PHP): a vendor that lists every affected supported line writes "< 8.3.32" meaning the
 * 8.3 line only. Such a bound without a lower one starts at its own line (8.3.0), so 8.2.x is not taken as affected
 * by a fix that never reached it because the bug is not there.
 */
export function perBranchRanges(advisories: Advisory[]): Advisory[] {
  return advisories.map((a) => ({
    ...a,
    affected: a.affected.map((range) => {
      if (range.fixed === undefined || (range.introduced !== undefined && range.introduced !== '0'))
        return range;
      const parts = range.fixed.split('.');
      if (parts.length < 2) return range;
      return { ...range, introduced: [...parts.slice(0, -1), '0'].join('.') };
    }),
  }));
}

const SEVERITY = '(critical|high|medium|moderate|low)';
const SCORE = '(10(?:\\.0)?|\\d\\.\\d)(?![\\d./])';
/** "(High, 8.1)", "Low/3.8": a score right after a severity word. */
const SCORE_AFTER_SEVERITY = new RegExp(`\\b${SEVERITY}\\s*[,:/]\\s*${SCORE}`, 'i');
/**
 * "CVSS 9.8", "CVSSv3 7.5", "CVSS 3.1 base score: 6.6" — not the version of "CVSS 3.1" or of a vector "CVSS:3.1/AV:N/…".
 */
const SCORE_AFTER_CVSS = new RegExp(
  `\\bCVSS(?:\\s*v?[234](?:\\.\\d)?)?(?:\\s+base)?(?:\\s+score)?\\s*[:=]?\\s*${SCORE}`,
  'i',
);
/** "(High)", "severity: high", "high severity". */
const SEVERITY_ONLY = new RegExp(
  `\\(\\s*${SEVERITY}\\s*\\)|\\bseverity\\s*[:=]?\\s*${SEVERITY}\\b|\\b${SEVERITY}\\s+severity\\b`,
  'i',
);
const REF_IN_TEXT = /\[?\b(?:CVE-\d{4}-\d{4,}|GHSA(?:-[0-9a-z]{4}){3})\b\]?/gi;

const severityWord = (word: string | undefined): Severity | undefined =>
  word === undefined
    ? undefined
    : word.toLowerCase() === 'moderate'
      ? 'medium'
      : (word.toLowerCase() as Severity);

/** The score and severity a release-note item gives its vulnerability, if it gives any. */
export function ratingIn(text: string): { score?: number; severity?: Severity } | undefined {
  const bySeverity = SCORE_AFTER_SEVERITY.exec(text);
  if (bySeverity) return { score: Number(bySeverity[2]), severity: severityWord(bySeverity[1])! };
  const byCvss = SCORE_AFTER_CVSS.exec(text);
  if (byCvss) return { score: Number(byCvss[1]) };
  const word = SEVERITY_ONLY.exec(text);
  const severity = severityWord(word?.[1] ?? word?.[2] ?? word?.[3]);
  return severity ? { severity } : undefined;
}

/** "Organization member revocation [GHSA-…] (High, 8.1)" → "Organization member revocation". */
function titleOf(text: string): string {
  return text
    .replace(REF_IN_TEXT, '')
    .replace(/\(https?:[^)]*\)/g, '')
    .replace(new RegExp(`\\(\\s*${SEVERITY}?\\s*[,:/]?\\s*(?:CVSS[^)]*|${SCORE})?\\s*\\)`, 'gi'), '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:,–—-]+|[\s:,–—-]+$/g, '')
    .trim();
}

/**
 * Projects on GitHub often ship a fix before its repository advisory is public ("private for now, pending CVE
 * assignment", Vaultwarden 1.37.4), but their notes say what it fixes: a security item that names one GHSA id no
 * advisory source knows (with a CVE id as an alias, if any) and rates it (a CVSS score or a severity) becomes an
 * advisory of source "vendor", fixed in that release (in each release that names it: backports) and linking to the
 * notes. Once the advisory is published, the security source knows the id and this one is no longer made.
 * CVE ids alone don't count: notes list fixed CVEs of bundled tools and dependencies too (Percona: MySQL Shell and
 * Router; Portainer: kubectl's Go modules), and a CVE of the product itself reaches NVD/OSV within days.
 */
export function noteAdvisories(
  releases: Release[],
  advisories: Advisory[],
  kev: ReadonlySet<string>,
): Advisory[] {
  const known = new Set(advisories.flatMap(keysOf));
  const found = new Map<string, Advisory>();
  const out: Advisory[] = [];
  // Oldest first, so the first release that names it dates it.
  for (const release of [...releases].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))) {
    for (const item of release.items) {
      if (item.type !== 'security' || item.classifiedBy === 'advisory' || !item.refs?.length) continue;
      const cves = item.refs.filter((r) => r.toUpperCase().startsWith('CVE-'));
      const ghsas = item.refs.filter((r) => r.toUpperCase().startsWith('GHSA-'));
      // No GHSA, or several vulnerabilities in one item (which rating belongs to which is not said).
      if (ghsas.length !== 1 || cves.length > 1) continue;
      const ids = [...ghsas, ...cves];
      if (ids.some((id) => known.has(id.toUpperCase()))) continue;
      const range = { introduced: '0', fixed: release.version };
      const existing = ids.map((id) => found.get(id.toUpperCase())).find((a) => a !== undefined);
      if (existing) {
        if (!existing.affected.some((r) => r.fixed === range.fixed)) existing.affected.push(range);
        continue;
      }
      const rating = ratingIn(item.text);
      if (!rating) continue;
      const advisory: Advisory = {
        id: ids[0]!,
        aliases: ids.slice(1),
        title: titleOf(item.text),
        cvss: rating.score === undefined ? null : { score: rating.score, vector: '', version: '' },
        severity: severityFromScore(rating.score, rating.severity ?? 'unknown'),
        kev: ids.some((id) => kev.has(id.toUpperCase())),
        published: release.date,
        affected: [range],
        source: 'vendor',
        url: release.url ?? '',
      };
      out.push(advisory);
      for (const id of ids) found.set(id.toUpperCase(), advisory);
    }
  }
  return out;
}

/** sortKey of every version an advisory names as its fix, under the module's scheme. */
function fixKeys(
  module: Pick<Module, 'versionScheme' | 'versionRegex' | 'branchGroups'>,
  advisory: Advisory,
): Set<string> {
  const keys = new Set<string>();
  for (const range of advisory.affected) {
    const v = range.fixed ? parse(module, range.fixed) : null;
    if (v) keys.add(v.sortKey);
  }
  return keys;
}

/**
 * Adds a synthetic security item to each release that fixes an advisory its notes don't mention (classifiedBy:
 * "advisory"). Items from earlier runs are replaced, so this always reflects the current advisories.
 */
export function linkAdvisories(module: Module, releases: Release[], advisories: Advisory[]): Release[] {
  // Exploited ones first, then by score: a Windows update fixes dozens.
  const fixes = [...advisories]
    .sort((a, b) => Number(b.kev) - Number(a.kev) || (b.cvss?.score ?? -1) - (a.cvss?.score ?? -1))
    .map((a) => ({ advisory: a, keys: fixKeys(module, a), refs: keysOf(a) }));
  return releases.map((release) => {
    const own = release.items.filter((i) => i.classifiedBy !== 'advisory');
    const mentioned = new Set(own.flatMap((i) => (i.refs ?? []).map((r) => r.toUpperCase())));
    const added: ChangeItem[] = [];
    for (const { advisory, keys, refs } of fixes) {
      if (!keys.has(release.sortKey) || refs.some((r) => mentioned.has(r))) continue;
      const text = `Fixes ${advisory.id}${advisory.title ? `: ${advisory.title}` : ''}`;
      added.push({
        type: 'security',
        text: text.length > 300 ? `${text.slice(0, 299)}…` : text,
        refs: [advisory.id, ...advisory.aliases],
        classifiedBy: 'advisory',
      });
    }
    if (added.length === 0 && own.length === release.items.length) return release;
    return { ...release, items: [...added, ...own] };
  });
}

/** Highest severity among advisories whose fix is this release (weekly digest). */
export function severityFixedIn(
  module: Pick<Module, 'versionScheme' | 'versionRegex' | 'branchGroups'>,
  advisories: Advisory[],
  release: Release,
): Severity | null {
  return maxSeverity(
    advisories.filter((a) => fixKeys(module, a).has(release.sortKey)).map((a) => a.severity),
  );
}
