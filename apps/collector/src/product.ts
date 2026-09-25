// One module → one product file (docs/04-collector.md steps 4–8): fetch, normalize, classify, merge with the
// previous feed. The previous feed is the source of truth: releases accumulate, and releases already published
// keep their items (stable output), while sortKey and track are recomputed so module edits apply at once.
import {
  fetchAdvisories,
  fetchLifecycle,
  fetchReleases,
  type AdapterContext,
  type Fetcher,
  type Logger,
  type RawBranch,
  type RawAdvisory,
  type RawRelease,
} from '@versiondrift/adapters';
import { createHash } from 'node:crypto';
import { CLASSIFIER_VERSION, classifyNotes } from '@versiondrift/classify';
import { parse, trackOf, type Version } from '@versiondrift/core';
import {
  FEED_FORMAT_VERSION,
  type Branch,
  type FeedProduct,
  type Module,
  type Release,
} from '@versiondrift/schema';
import { linkAdvisories, mergeAdvisories } from './advisories.ts';
import { sourceLinks } from './links.ts';

export interface CollectContext {
  fetcher: Fetcher;
  log: Logger;
  now: Date;
  readRepoFile?: (path: string) => Promise<string>;
  /** First runs fetch at most this far back. */
  retentionYears?: number;
  /** CVE ids in CISA's Known Exploited Vulnerabilities catalog. */
  kev?: ReadonlySet<string>;
}

export type ProductResult =
  | { ok: true; product: FeedProduct; newReleases: string[]; warnings: string[] }
  | { ok: false; error: string; product?: FeedProduct; warnings: string[] };

const PRERELEASE = /(?:^|[^a-z])(?:alpha|beta|rc|pre|preview|dev|snapshot|nightly|canary)(?:[^a-z]|$)/i;

export const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

interface Candidate {
  version: Version;
  raw: RawRelease;
  prerelease: boolean;
}

/** tagFilter → parse under the scheme → pre-release rule. Keeps the first release per version. */
function normalize(
  module: Module,
  raws: RawRelease[],
  warnings: string[],
  label: string,
): Map<string, Candidate> {
  const include = module.tagFilter?.include ? new RegExp(module.tagFilter.include) : undefined;
  const exclude = module.tagFilter?.exclude ? new RegExp(module.tagFilter.exclude) : undefined;
  const out = new Map<string, Candidate>();
  const unparsed: string[] = [];
  for (const raw of raws) {
    if (include && !include.test(raw.version)) continue;
    if (exclude?.test(raw.version)) continue;
    const version = parse(module, raw.version);
    if (!version) {
      unparsed.push(raw.version);
      continue;
    }
    const prerelease = raw.prerelease === true || PRERELEASE.test(version.raw);
    if (prerelease && module.prerelease === 'skip') continue;
    if (!out.has(version.sortKey)) out.set(version.sortKey, { version, raw, prerelease });
  }
  if (unparsed.length > 0) {
    const sample = unparsed.slice(0, 5).join(', ');
    warnings.push(
      `${label}: ${unparsed.length} version(s) don't parse as ${module.versionScheme}: ${sample}${unparsed.length > 5 ? ', …' : ''}`,
    );
  }
  return out;
}

function isInBranch(version: string, branch: string): boolean {
  return version === branch || version.startsWith(`${branch}.`) || version.startsWith(`${branch}-`);
}

function buildBranches(raw: RawBranch[], releases: Release[]): Branch[] {
  return raw.map((b) => {
    const latest =
      releases.find((r) => !r.prerelease && isInBranch(r.version, b.name))?.version ?? b.latest ?? null;
    return {
      id: b.name,
      codename: b.codename ?? null,
      releaseDate: b.releaseDate ?? null,
      eol: b.eol,
      eolDate: b.eolDate ?? null,
      lts: b.lts,
      latest,
    };
  });
}

function toRelease(module: Module, c: Candidate, firstSeenAt: string): { release: Release; omitted: number } {
  const { items, omitted } = classifyNotes(c.raw.notes, module.classify);
  return {
    release: {
      version: c.version.raw,
      sortKey: c.version.sortKey,
      track: trackOf(module, c.version.raw),
      date: c.raw.date ?? null,
      firstSeenAt,
      url: module.releaseNotesUrl?.replaceAll('{version}', c.version.raw) ?? c.raw.url ?? null,
      prerelease: c.prerelease,
      items,
      ...(omitted > 0 && { moreItems: omitted }),
      summary: null,
    },
    omitted,
  };
}

/** Re-derives sortKey and track for a previously published release; null if it no longer fits the module. */
function refresh(module: Module, release: Release): Release | null {
  const version = parse(module, release.version);
  if (!version) return null;
  if (release.prerelease && module.prerelease === 'skip') return null;
  return { ...release, sortKey: version.sortKey, track: trackOf(module, version.raw) };
}

function staleCopy(previous: FeedProduct | undefined): FeedProduct | undefined {
  return previous && { ...previous, stale: true };
}

export async function collectProduct(
  module: Module,
  previous: FeedProduct | undefined,
  ctx: CollectContext,
): Promise<ProductResult> {
  const warnings: string[] = [];
  const now = isoSeconds(ctx.now);
  const knownVersions = new Set((previous?.releases ?? []).flatMap((r) => [r.version, `v${r.version}`]));
  const since = new Date(ctx.now);
  since.setUTCFullYear(since.getUTCFullYear() - (ctx.retentionYears ?? 3));
  const adapterCtx: AdapterContext = {
    fetcher: ctx.fetcher,
    log: ctx.log,
    knownVersions,
    since,
    ...(ctx.readRepoFile && { readRepoFile: ctx.readRepoFile }),
  };

  let primary: RawRelease[];
  try {
    primary = await fetchReleases(module.sources.releases, adapterCtx);
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message,
      ...(previous && { product: staleCopy(previous)! }),
      warnings,
    };
  }
  const candidates = normalize(module, primary, warnings, module.sources.releases.type);

  // Extra sources only enrich releases the primary source knows (notes, dates, links). Primary notes that
  // yield no items (e.g. "Downloads: … Release notes: …" links) count as missing.
  const hasContent = (notes: RawRelease['notes']) => classifyNotes(notes, module.classify).items.length > 0;
  for (const extra of module.sources.releasesExtra ?? []) {
    try {
      const enrich = normalize(module, await fetchReleases(extra, adapterCtx), [], extra.type);
      for (const [key, c] of candidates) {
        const e = enrich.get(key);
        if (!e) continue;
        c.raw = {
          ...c.raw,
          ...(e.raw.notes && !hasContent(c.raw.notes) && { notes: e.raw.notes }),
          ...(!c.raw.date && e.raw.date && { date: e.raw.date }),
          ...(!c.raw.url && e.raw.url && { url: e.raw.url }),
        };
      }
    } catch (error) {
      warnings.push(`${extra.type} (extra): ${(error as Error).message}`);
    }
  }

  let lifecycle: RawBranch[] = [];
  if (module.sources.eol) {
    try {
      lifecycle = await fetchLifecycle(module.sources.eol, adapterCtx);
    } catch (error) {
      warnings.push(`${module.sources.eol.type}: ${(error as Error).message}`);
      lifecycle = (previous?.branches ?? []).map((b) => ({
        name: b.id,
        ...(b.codename && { codename: b.codename }),
        ...(b.releaseDate && { releaseDate: b.releaseDate }),
        eol: b.eol,
        ...(b.eolDate && { eolDate: b.eolDate }),
        lts: b.lts,
      }));
    }
  }

  // Advisories: every security source; if all of them fail, the previous advisories stay.
  const securitySources = module.sources.security ?? [];
  const advisoryLists: RawAdvisory[][] = [];
  for (const source of securitySources) {
    try {
      advisoryLists.push(await fetchAdvisories(source, adapterCtx));
    } catch (error) {
      warnings.push(`${source.type} (security): ${(error as Error).message}`);
    }
  }
  const advisories =
    securitySources.length > 0 && advisoryLists.length === 0
      ? (previous?.advisories ?? [])
      : mergeAdvisories(advisoryLists, ctx.kev ?? new Set());

  const moduleHash = createHash('sha256')
    .update(JSON.stringify(module))
    .update(CLASSIFIER_VERSION)
    .digest('hex')
    .slice(0, 16);
  const reclassify = previous !== undefined && previous.moduleHash !== moduleHash;
  const merged = new Map<string, Release>();
  for (const release of previous?.releases ?? []) {
    const refreshed = refresh(module, release);
    if (refreshed && !merged.has(refreshed.sortKey)) merged.set(refreshed.sortKey, refreshed);
  }
  const newReleases: string[] = [];
  for (const [key, c] of candidates) {
    const known = merged.get(key);
    if (known) {
      // Published items stay as they are unless the module or the classifier changed.
      const next: Release = {
        ...known,
        date: known.date ?? c.raw.date ?? null,
        url: known.url ?? c.raw.url ?? null,
      };
      if (reclassify) {
        const fresh = toRelease(module, c, now).release;
        next.items = fresh.items;
        next.url = fresh.url;
        if (fresh.moreItems === undefined) delete next.moreItems;
        else next.moreItems = fresh.moreItems;
      }
      merged.set(key, next);
      continue;
    }
    merged.set(key, toRelease(module, c, now).release);
    newReleases.push(c.version.raw);
  }

  const releases = linkAdvisories(
    module,
    [...merged.values()].sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0)),
    advisories,
  );
  if (releases.length === 0) {
    return {
      ok: false,
      error: `no releases found (${primary.length} raw entries from ${module.sources.releases.type}, none usable)`,
      ...(previous && { product: staleCopy(previous)! }),
      warnings,
    };
  }
  if (releases.every((r) => r.date === null))
    warnings.push('no release dates: "released" times fall back to first seen');

  const product: FeedProduct = {
    formatVersion: FEED_FORMAT_VERSION,
    id: module.id,
    name: module.name,
    versionScheme: module.versionScheme,
    ...(module.versionScheme === 'regex' &&
      module.versionRegex !== undefined && { versionRegex: module.versionRegex }),
    ...(module.versionScheme === 'regex' &&
      module.branchGroups !== undefined && { branchGroups: module.branchGroups }),
    tracks: module.tracks ?? [],
    defaultTrack: module.defaultTrack,
    sources: sourceLinks(module),
    branches: buildBranches(lifecycle, releases),
    releases,
    advisories,
    collectedAt: now,
    lastSuccessAt: now,
    stale: false,
    moduleHash,
  };
  if (reclassify) warnings.push('module or classifier changed: items of current releases recomputed');
  return { ok: true, product, newReleases, warnings };
}
