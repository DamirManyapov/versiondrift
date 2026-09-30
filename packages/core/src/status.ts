// Status engine (docs/05-status-engine.md): one product + what the user runs → critical / eol / update / ok / news /
// stale, with the releases and advisories behind it. Pure; runs in the browser, Workers and Node alike.
import type { Advisory, Branch, FeedProduct, ItemType, Release } from '@versiondrift/schema';
import { inTrack, isTrack, trackOf } from './tracks.ts';
import { compare, parse, type SchemeSpec } from './version.ts';

export type Status = 'critical' | 'eol' | 'update' | 'ok' | 'news' | 'stale';
export const STATUS_ORDER: Status[] = ['critical', 'eol', 'update', 'ok', 'stale', 'news'];

export interface Installed {
  productId: string;
  version?: string;
  track?: string;
  label?: string;
  host?: string;
}

export interface StatusSettings {
  /** CVSS score from which an affecting advisory makes the status critical. */
  criticalCvss: number;
  treatKevAsCritical: boolean;
  /** Flag `eolSoon` when the branch reaches end of life within this many days. */
  eolWarnDays: number;
}

export const DEFAULT_SETTINGS: StatusSettings = {
  criticalCvss: 7.0,
  treatKevAsCritical: true,
  eolWarnDays: 90,
};

export type StatusFlag =
  /** The installed version is not among the product's releases (still compared by the scheme). */
  | 'unknownVersion'
  /** The installed version does not parse under the product's scheme. */
  | 'invalidVersion'
  /** The branch reaches end of life within eolWarnDays. */
  | 'eolSoon'
  /** A newer release exists outside the chosen track ("new major available"). */
  | 'otherTrackNewer'
  /** The product's data is stale (collection failing), whatever the status. */
  | 'staleData';

export interface ProductStatus {
  status: Status;
  installed?: string;
  latest: string | null;
  track: string;
  /** Releases newer than the installed one in the track, newest first. */
  newer: Release[];
  counts: Record<ItemType, number>;
  /** Advisories affecting the installed version, highest score first. */
  affecting: Advisory[];
  maxCvss?: number;
  branch?: Branch;
  /** Newest release in any track, when it is newer than `latest` (otherTrackNewer). */
  newestOverall?: string;
  flags: StatusFlag[];
}

const LATEST = 'latest';
const STALE_AFTER_DAYS = 7;

export const specOf = (
  product: Pick<FeedProduct, 'versionScheme' | 'versionRegex' | 'branchGroups'>,
): SchemeSpec => ({
  versionScheme: product.versionScheme,
  ...(product.versionRegex !== undefined && { versionRegex: product.versionRegex }),
  ...(product.branchGroups !== undefined && { branchGroups: product.branchGroups }),
});

function emptyCounts(): Record<ItemType, number> {
  return { security: 0, breaking: 0, deprecated: 0, feature: 0, fix: 0, other: 0 };
}

function isInBranch(version: string, branch: string): boolean {
  return version === branch || version.startsWith(`${branch}.`) || version.startsWith(`${branch}-`);
}

/** The lifecycle branch of a version: the branch whose id is the longest prefix of it ("13.2.1" → "13.2", "12.7" → "12"). */
export function branchFor(branches: Branch[], version: string): Branch | undefined {
  return branches.filter((b) => isInBranch(version, b.id)).sort((a, b) => b.id.length - a.id.length)[0];
}

const upperOnly = (range: Advisory['affected'][number]) =>
  range.introduced === undefined || range.introduced === '0';

/** "2.41.4" → "2.41": the line a patch release belongs to (everything before the last dot). */
const lineOf = (version: string) =>
  version.includes('.') ? version.slice(0, version.lastIndexOf('.')) : undefined;

/**
 * Backports written as overlapping upper bounds: n8n lists "< 2.42.1" and "< 2.41.4" for one advisory, meaning the
 * 2.41 line is fixed in 2.41.4 and the 2.42 line in 2.42.1. A version at or past an upper-only fix of its own line is
 * fixed, whatever the other upper-only ranges say (a single range, or ranges with lower bounds, read as OSV).
 */
function backported(spec: SchemeSpec, version: string, ranges: Advisory['affected']): boolean {
  const line = lineOf(version);
  if (!line || ranges.filter(upperOnly).length < 2) return false;
  return ranges.some((r) => {
    try {
      return upperOnly(r) && r.fixed?.startsWith(`${line}.`) === true && compare(spec, version, r.fixed) >= 0;
    } catch {
      return false;
    }
  });
}

/**
 * OSV range semantics: affected when ≥ introduced (or no introduced / "0"), < fixed and ≤ last_affected; see
 * `backported` for overlapping upper bounds. Ranges with versions that don't parse under the scheme are ignored.
 */
export function isAffected(spec: SchemeSpec, version: string, ranges: Advisory['affected']): boolean {
  const v = parse(spec, version);
  if (!v) return false;
  const fixedInLine = backported(spec, version, ranges);
  return ranges.some((range) => {
    if (fixedInLine && upperOnly(range)) return false;
    try {
      if (
        range.introduced !== undefined &&
        range.introduced !== '0' &&
        compare(spec, v, range.introduced) < 0
      )
        return false;
      if (range.fixed !== undefined && compare(spec, v, range.fixed) >= 0) return false;
      if (range.last_affected !== undefined && compare(spec, v, range.last_affected) > 0) return false;
      return range.introduced !== undefined || range.fixed !== undefined || range.last_affected !== undefined;
    } catch {
      return false;
    }
  });
}

/**
 * The fix for this version: the `fixed` bound of the range that contains it (per-branch fixes differ); among
 * overlapping upper bounds the fix in the version's own line, else the lowest one above it.
 */
export function fixedIn(spec: SchemeSpec, version: string, ranges: Advisory['affected']): string | undefined {
  if (!isAffected(spec, version, ranges)) return undefined;
  const containing = ranges.filter(
    (range) => range.fixed !== undefined && isAffected(spec, version, [range]),
  );
  const line = lineOf(version);
  const own = containing.find((range) => upperOnly(range) && line && range.fixed!.startsWith(`${line}.`));
  if (own) return own.fixed;
  return containing
    .map((range) => range.fixed!)
    .sort((a, b) => {
      try {
        return compare(spec, a, b);
      } catch {
        return 0;
      }
    })[0];
}

function isCritical(a: Advisory, settings: StatusSettings): boolean {
  return (
    (settings.treatKevAsCritical && a.kev) ||
    (a.cvss !== null && a.cvss.score >= settings.criticalCvss) ||
    a.severity === 'critical'
  );
}

export function computeStatus(
  product: FeedProduct,
  installed: Installed,
  settings: StatusSettings = DEFAULT_SETTINGS,
  now: Date = new Date(),
): ProductStatus {
  const spec = specOf(product);
  const stable = product.releases.filter((r) => !r.prerelease);
  const stale =
    product.stale &&
    (product.lastSuccessAt === null ||
      now.getTime() - Date.parse(product.lastSuccessAt) > STALE_AFTER_DAYS * 86_400_000);
  const flags: StatusFlag[] = stale ? ['staleData'] : [];
  const base = { newer: [], counts: emptyCounts(), affecting: [], flags };

  const raw = installed.version?.trim();
  const version = raw ? parse(spec, raw) : null;
  // A pinned track the product no longer has (renamed channels) counts as not pinned.
  const pinned =
    installed.track !== undefined && isTrack(product, installed.track) ? installed.track : undefined;
  if (!raw || !version) {
    const track = pinned ?? product.defaultTrack;
    const latest = product.releases.find((r) => inTrack(product, track, r)) ?? stable[0];
    return {
      ...base,
      status: stale ? 'stale' : 'news',
      ...(raw && { installed: raw }),
      latest: latest?.version ?? null,
      track,
      flags: raw ? [...flags, 'invalidVersion'] : flags,
    };
  }

  // Track: the user's choice, else the one the version belongs to, else the module default.
  const track = pinned ?? trackOf(product, version.raw) ?? product.defaultTrack;
  const candidates = product.releases.filter((r) => inTrack(product, track, r));
  const latest = candidates[0] ?? null;
  const newer = candidates.filter((r) => r.sortKey > version.sortKey);
  if (!product.releases.some((r) => r.sortKey === version.sortKey)) flags.push('unknownVersion');

  const newestOverall = stable[0];
  if (track !== LATEST && newestOverall && latest && newestOverall.sortKey > latest.sortKey)
    flags.push('otherTrackNewer');

  // By prefix; else the scheme's branch ("10.0.20348.5499" is in branch 20348 when versions drop the "10.0.").
  const branch =
    branchFor(product.branches, version.raw) ?? product.branches.find((b) => b.id === version.branch);
  if (branch && !branch.eol && branch.eolDate) {
    const days = (Date.parse(`${branch.eolDate}T00:00:00Z`) - now.getTime()) / 86_400_000;
    if (days <= settings.eolWarnDays) flags.push('eolSoon');
  }
  const eol =
    branch?.eol === true ||
    (branch?.eolDate !== null &&
      branch?.eolDate !== undefined &&
      Date.parse(`${branch.eolDate}T00:00:00Z`) <= now.getTime());

  const affecting = product.advisories
    .filter((a) => isAffected(spec, version.raw, a.affected))
    .sort((a, b) => (b.cvss?.score ?? -1) - (a.cvss?.score ?? -1));
  const maxCvss = affecting.reduce<number | undefined>(
    (max, a) => (a.cvss ? Math.max(max ?? 0, a.cvss.score) : max),
    undefined,
  );

  const counts = emptyCounts();
  for (const release of newer) for (const item of release.items) counts[item.type]++;

  const status: Status = stale
    ? 'stale'
    : affecting.some((a) => isCritical(a, settings))
      ? 'critical'
      : eol
        ? 'eol'
        : newer.length > 0
          ? 'update'
          : 'ok';

  return {
    status,
    installed: version.raw,
    latest: latest?.version ?? null,
    track,
    newer,
    counts,
    affecting,
    ...(maxCvss !== undefined && { maxCvss }),
    ...(branch && { branch }),
    ...(flags.includes('otherTrackNewer') && newestOverall && { newestOverall: newestOverall.version }),
    flags,
  };
}

/** Worst status among several instances of one product (self-hosted, accounts): "2 of 5 affected". */
export function worstStatus(statuses: Status[]): Status {
  return STATUS_ORDER.find((s) => statuses.includes(s)) ?? 'news';
}

export interface Changelog {
  releases: Release[];
  /** Advisories whose fix lies in (from, to]. */
  fixedAdvisories: Advisory[];
}

/** Releases with from < v ≤ to in the track, newest first (docs/05 "Merged changelog"). */
export function changelog(product: FeedProduct, from: string, to: string, track: string = LATEST): Changelog {
  const spec = specOf(product);
  const a = parse(spec, from);
  const b = parse(spec, to);
  if (!a || !b) return { releases: [], fixedAdvisories: [] };
  const releases = product.releases.filter(
    (r) => r.sortKey > a.sortKey && r.sortKey <= b.sortKey && inTrack(product, track, r),
  );
  const fixedAdvisories = product.advisories.filter((adv) =>
    adv.affected.some((range) => {
      const fixed = range.fixed ? parse(spec, range.fixed) : null;
      return fixed !== null && fixed.sortKey > a.sortKey && fixed.sortKey <= b.sortKey;
    }),
  );
  return { releases, fixedAdvisories };
}
