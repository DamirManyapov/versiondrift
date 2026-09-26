// Feed files from collected products (docs/03-feed-format.md): index, catalog, health, weekly digests.
import { createHash } from 'node:crypto';
import { branchFor, inTrack } from '@versiondrift/core';
import { maxSeverity, severityFixedIn } from './advisories.ts';
import {
  FEED_FORMAT_VERSION,
  type Catalog,
  type FeedIndex,
  type FeedProduct,
  type Health,
  type HealthEntry,
  type IndexEntry,
  type Module,
  type Versions,
  type WeekDigest,
} from '@versiondrift/schema';

/** Product files are compact JSON; the index stores the sha256 of exactly these bytes. */
export function serializeProduct(product: FeedProduct): string {
  return JSON.stringify(product);
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const MONTH = 30 * 86_400_000;

export function indexEntry(
  module: Module,
  product: FeedProduct,
  bytes: string,
  now: Date = new Date(),
): IndexEntry {
  const hash = sha256(bytes);
  const stable = product.releases.filter((r) => !r.prerelease);
  const latest = stable[0];
  // Latest per track by each track's own rule: tracks may overlap (update channels).
  const tracks: Record<string, string> = {};
  for (const track of product.tracks) {
    const release = product.releases.find((r) => inTrack(product, track.id, r));
    if (release) tracks[track.id] = release.version;
  }
  return {
    name: product.name,
    category: module.category,
    latest: latest?.version ?? null,
    latestDate: latest ? (latest.date ?? latest.firstSeenAt) : null,
    tracks,
    maxSeverityLast30d: maxSeverity(
      product.advisories
        .filter((a) => a.published !== null && now.getTime() - Date.parse(a.published) <= MONTH)
        .map((a) => a.severity),
    ),
    hasSecuritySource: (module.sources.security?.length ?? 0) > 0,
    updatedAt: product.lastSuccessAt ?? product.collectedAt,
    stale: product.stale,
    sha256: hash,
    // The query string changes with the content, so a CDN never pairs a new index with an old cached product file.
    url: `products/${product.id}.json?v=${hash.slice(0, 12)}`,
  };
}

export function buildIndex(
  entries: Record<string, IndexEntry>,
  generatedAt: string,
  collectorVersion: string,
): FeedIndex {
  const products = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
  return { formatVersion: FEED_FORMAT_VERSION, generatedAt, collectorVersion, products };
}

export function buildCatalog(modules: Module[], generatedAt: string): Catalog {
  return {
    formatVersion: FEED_FORMAT_VERSION,
    generatedAt,
    products: [...modules]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        ...(m.vendor && { vendor: m.vendor }),
        ...(m.homepage && { homepage: m.homepage }),
        ...(m.logo && { logo: m.logo }),
        ...(m.description && { description: m.description }),
        ...(m.aliases?.length && { aliases: m.aliases }),
      })),
  };
}

const RECENT_VERSIONS = 20;

/** versions.json: per product the newest stable releases and the newest stable release of each branch. */
export function buildVersions(products: FeedProduct[], generatedAt: string): Versions {
  const out: Versions['products'] = {};
  for (const product of [...products].sort((a, b) => a.id.localeCompare(b.id))) {
    const stable = product.releases.filter((r) => !r.prerelease);
    const branches = new Map<string, string>();
    for (const release of stable) {
      const branch = branchFor(product.branches, release.version);
      if (branch && !branches.has(branch.id)) branches.set(branch.id, release.version);
    }
    const recent = stable.slice(0, RECENT_VERSIONS);
    out[product.id] = {
      recent: recent.map((r) => r.version),
      branches: [...branches.values()],
      notes: recent.some((r) => r.items.length > 0),
    };
  }
  return { formatVersion: FEED_FORMAT_VERSION, generatedAt, products: out };
}

export function buildHealth(modules: Record<string, HealthEntry>, generatedAt: string): Health {
  const entries = Object.entries(modules).sort(([a], [b]) => a.localeCompare(b));
  const ok = entries.filter(([, h]) => h.status === 'ok').length;
  return {
    formatVersion: FEED_FORMAT_VERSION,
    generatedAt,
    ok: entries.length ? ok / entries.length : 1,
    modules: Object.fromEntries(entries),
  };
}

/** ISO 8601 week of a UTC date: { year, week, monday }. */
export function isoWeek(date: Date): { year: number; week: number; monday: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: thursday.getUTCFullYear(), week, monday };
}

export const weekId = (w: { year: number; week: number }) => `${w.year}-W${String(w.week).padStart(2, '0')}`;

/** Digests for the `weeks` most recent ISO weeks (including the current one), keyed by "2026-W39". */
export function buildWeeks(products: FeedProduct[], now: Date, weeks = 12): Map<string, WeekDigest> {
  const out = new Map<string, WeekDigest>();
  const current = isoWeek(now).monday;
  for (let i = 0; i < weeks; i++) {
    const monday = new Date(current);
    monday.setUTCDate(current.getUTCDate() - 7 * i);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const id = weekId(isoWeek(monday));
    out.set(id, {
      week: id,
      from: monday.toISOString().slice(0, 10),
      to: sunday.toISOString().slice(0, 10),
      entries: [],
    });
  }
  for (const product of products) {
    for (const release of product.releases) {
      if (release.prerelease) continue;
      const date = release.date ?? release.firstSeenAt;
      const digest = out.get(weekId(isoWeek(new Date(date))));
      if (!digest) continue;
      digest.entries.push({
        product: product.id,
        version: release.version,
        date,
        types: [...new Set(release.items.map((i) => i.type))].sort(),
        maxSeverity: severityFixedIn(product, product.advisories, release),
      });
    }
  }
  for (const digest of out.values()) {
    digest.entries.sort((a, b) => b.date.localeCompare(a.date) || a.product.localeCompare(b.product));
  }
  return out;
}
