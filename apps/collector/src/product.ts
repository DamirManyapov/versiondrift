// One module → one product file (docs/04-collector.md steps 4–8): fetch, normalize, classify, merge with the
// previous feed. The previous feed is the source of truth: releases accumulate, and releases already published
// keep their items (stable output), while sortKey and track are recomputed so module edits apply at once.
import {
  fetchAdvisories,
  fetchLifecycle,
  fetchNotes,
  fetchReleases,
  readPointer,
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
  FeedProduct,
  releaseSourcesOf,
  type Branch,
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

/** Per-version notes fetched in one run at most (a first run of a long history catches up over a few days). */
const NOTES_PER_RUN = 200;

/**
 * The module's tracks as the feed carries them: pointer tracks (`current`) become the regex of the branch their URL
 * names now ("7.23.7" → ^7\.23(\.|$)). If the URL fails, the previous feed's rule stays.
 */
async function resolveTracks(
  module: Module,
  previous: FeedProduct | undefined,
  ctx: AdapterContext,
  warnings: string[],
): Promise<FeedProduct['tracks']> {
  const out: FeedProduct['tracks'] = [];
  for (const track of module.tracks ?? []) {
    const common = {
      id: track.id,
      ...(track.label && { label: track.label }),
      ...(track.group && { group: track.group }),
      ...(track.prereleases && { prereleases: true }),
    };
    if (track.match !== undefined) {
      out.push({ ...common, match: track.match });
      continue;
    }
    try {
      const { version } = await readPointer(track.current!.url, track.current!.versionRegex, ctx);
      const branch = /^v?(\d+)\.(\d+)/.exec(version);
      if (!branch) throw new Error(`"${version}" has no major.minor`);
      out.push({ ...common, match: `^${branch[1]}\\.${branch[2]}(\\.|$)`, current: version });
    } catch (error) {
      const kept = previous?.tracks.find((t) => t.id === track.id);
      warnings.push(
        `track ${track.id}: ${(error as Error).message}${kept ? ' (kept the previous branch)' : ''}`,
      );
      // A track that matches nothing still exists, so pinned instances and defaultTrack stay valid.
      out.push(
        kept
          ? { ...common, match: kept.match, ...(kept.current && { current: kept.current }) }
          : { ...common, match: '(?!)' },
      );
    }
  }
  return out;
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
    now: ctx.now,
    ...(ctx.readRepoFile && { readRepoFile: ctx.readRepoFile }),
  };

  // Tracks first: a pointer track's regex (the channel's current branch) decides which track releases are in.
  const tracks = await resolveTracks(module, previous, adapterCtx, warnings);
  const tracked: Module = { ...module, tracks: tracks as Module['tracks'] };

  // Primary notes that yield no items (e.g. "Downloads: … Release notes: …" links, an empty <pre>) count as missing.
  const hasContent = (notes: RawRelease['notes']) => classifyNotes(notes, module.classify).items.length > 0;

  // Primary sources: each may add versions; the first to name a version wins, later ones fill gaps. The run fails
  // only when none of them answers.
  const sources = releaseSourcesOf(module);
  const primary: RawRelease[] = [];
  const candidates = new Map<string, Candidate>();
  const failures: string[] = [];
  for (const source of sources) {
    let raws: RawRelease[];
    try {
      raws = await fetchReleases(source, adapterCtx);
    } catch (error) {
      failures.push(`${source.type}: ${(error as Error).message}`);
      continue;
    }
    primary.push(...raws);
    for (const [key, c] of normalize(tracked, raws, warnings, source.type)) {
      const have = candidates.get(key);
      if (!have) candidates.set(key, c);
      else
        have.raw = {
          ...have.raw,
          ...(!hasContent(have.raw.notes) && hasContent(c.raw.notes) && { notes: c.raw.notes }),
          ...(!have.raw.date && c.raw.date && { date: c.raw.date }),
          ...(!have.raw.url && c.raw.url && { url: c.raw.url }),
        };
    }
  }
  if (failures.length === sources.length) {
    return {
      ok: false,
      error: failures.join('; '),
      ...(previous && { product: staleCopy(previous)! }),
      warnings,
    };
  }
  warnings.push(...failures.map((f) => `${f} (other release sources answered)`));

  // Extra sources only enrich releases the primary sources know (notes, dates, links).
  for (const extra of module.sources.releasesExtra ?? []) {
    if (extra.type === 'notes') continue; // per version, below: only for the releases being classified
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
    const refreshed = refresh(tracked, release);
    if (refreshed && !merged.has(refreshed.sortKey)) merged.set(refreshed.sortKey, refreshed);
  }

  // Per-version notes files: for new releases, for published ones after a module change or still without items (a
  // capped or failed fetch earlier); new ones first, then newest first. `pending` notes were due but not fetched: a
  // module change keeps those releases' published items rather than reclassifying them without notes.
  const pending = new Set<string>();
  for (const extra of module.sources.releasesExtra ?? []) {
    if (extra.type !== 'notes') continue;
    const limit = extra.perRun ?? NOTES_PER_RUN;
    const fresh: [string, Candidate][] = [];
    const again: [string, Candidate][] = [];
    for (const [key, c] of candidates) {
      if (!extra.override && hasContent(c.raw.notes)) continue;
      const known = merged.get(key);
      if (!known) fresh.push([key, c]);
      else if (reclassify || known.items.length === 0) again.push([key, c]);
    }
    const byDate = (a: [string, Candidate], b: [string, Candidate]) =>
      (b[1].raw.date ?? '').localeCompare(a[1].raw.date ?? '');
    const queue = [...fresh.sort(byDate), ...again.sort(byDate)];
    if (queue.length > limit)
      warnings.push(
        `notes: ${queue.length} releases need notes, ${limit} fetched; the rest follow in later runs`,
      );
    for (const [i, [key, c]] of queue.entries()) {
      if (i >= limit) {
        pending.add(key);
        continue;
      }
      try {
        const found = await fetchNotes(extra, c.raw.version, adapterCtx, c.raw.url);
        if (found)
          c.raw = { ...c.raw, notes: found.notes, ...(!c.raw.date && found.date && { date: found.date }) };
      } catch (error) {
        pending.add(key);
        warnings.push(`notes (extra) for ${c.raw.version}: ${(error as Error).message}`);
      }
    }
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
      // A published release without items is classified as soon as some source has notes for it (a page that
      // lagged, a notes file fetched in a later run).
      if (reclassify ? !pending.has(key) : known.items.length === 0 && hasContent(c.raw.notes)) {
        const fresh = toRelease(tracked, c, now).release;
        next.items = fresh.items;
        next.url = fresh.url;
        if (fresh.moreItems === undefined) delete next.moreItems;
        else next.moreItems = fresh.moreItems;
      }
      merged.set(key, next);
      continue;
    }
    merged.set(key, toRelease(tracked, c, now).release);
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
      error: `no releases found (${primary.length} raw entries from ${sources.map((s) => s.type).join(', ')}, none usable)`,
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
    tracks,
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
  // Clients parse product files strictly, so a source returning something odd must not reach the feed.
  const check = FeedProduct.safeParse(product);
  if (!check.success) {
    const issue = check.error.issues[0];
    return {
      ok: false,
      error: `invalid product data at ${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'schema mismatch'}`,
      ...(previous && { product: staleCopy(previous)! }),
      warnings,
    };
  }
  if (reclassify) warnings.push('module or classifier changed: items of current releases recomputed');
  return { ok: true, product, newReleases, warnings };
}
