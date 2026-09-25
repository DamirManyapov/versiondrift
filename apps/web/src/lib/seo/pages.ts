// Compare and version pages (docs/06 "SEO"): canonical versions and the data both pages show.
// Only known releases get a page, so search engines never see thin or invented URLs.
import {
  changelog,
  computeStatus,
  fixedIn,
  isAffected,
  normalizeVersion,
  parse,
  specOf,
  type ProductStatus,
} from '@versiondrift/core';
import type { Advisory, ChangeItem, FeedProduct, ItemType, Release } from '@versiondrift/schema';

/** The release as the feed spells it ("v11.3.1" → "11.3.1"), or undefined when the product has no such release. */
export function knownRelease(product: FeedProduct, raw: string): Release | undefined {
  const version = parse(specOf(product), normalizeVersion(decodeURIComponent(raw)));
  if (!version) return undefined;
  return product.releases.find((r) => r.sortKey === version.sortKey);
}

export interface Tagged {
  version: string;
  item: ChangeItem;
}

export interface CompareView {
  from: Release;
  to: Release;
  /** Releases in (from, to], newest first. */
  releases: Release[];
  counts: Record<ItemType, number>;
  security: Tagged[];
  breaking: Tagged[];
  deprecated: Tagged[];
  /** Advisories that affect `from` but not `to`: what the upgrade fixes. */
  fixedAdvisories: Advisory[];
}

export type CompareResult =
  | { kind: 'page'; view: CompareView }
  | { kind: 'redirect'; range: string }
  | { kind: 'notFound'; reason: string };

export const rangeParam = (from: string, to: string) => `${from}...${to}`;

/** "11.3.1...12.1.2" → the page, a redirect to the canonical range (order, spelling), or not found. */
export function compareView(product: FeedProduct, range: string): CompareResult {
  const at = range.indexOf('...');
  if (at < 0) return { kind: 'notFound', reason: 'not a range' };
  let a = knownRelease(product, range.slice(0, at));
  let b = knownRelease(product, range.slice(at + 3));
  if (!a || !b) return { kind: 'notFound', reason: 'unknown version' };
  if (a.sortKey === b.sortKey) return { kind: 'notFound', reason: 'same version' };
  if (a.sortKey > b.sortKey) [a, b] = [b, a];
  const canonical = rangeParam(a.version, b.version);
  if (canonical !== decodeURIComponent(range)) return { kind: 'redirect', range: canonical };

  const { releases } = changelog(product, a.version, b.version);
  const from = a;
  const to = b;
  const fixedAdvisories = product.advisories.filter(
    (adv) =>
      isAffected(product, from.version, adv.affected) && !isAffected(product, to.version, adv.affected),
  );
  // No thin pages (docs/06): nothing in the notes and nothing fixed means nothing to show.
  if (releases.every((r) => r.items.length === 0) && fixedAdvisories.length === 0)
    return { kind: 'notFound', reason: 'nothing changed in between' };
  const counts = emptyCounts();
  const pick = (type: ItemType): Tagged[] =>
    releases.flatMap((r) =>
      r.items.filter((i) => i.type === type).map((item) => ({ version: r.version, item })),
    );
  for (const r of releases) for (const item of r.items) counts[item.type]++;
  return {
    kind: 'page',
    view: {
      from: a,
      to: b,
      releases,
      counts,
      security: pick('security'),
      breaking: pick('breaking'),
      deprecated: pick('deprecated'),
      fixedAdvisories,
    },
  };
}

export interface VersionView {
  release: Release;
  status: ProductStatus;
  /** "fixed in" per advisory affecting the version. */
  fixes: Record<string, string | undefined>;
}

export type VersionResult =
  { kind: 'page'; view: VersionView } | { kind: 'redirect'; version: string } | { kind: 'notFound' };

/** "Is <version> affected?": the status engine's verdict for one known release. */
export function versionView(product: FeedProduct, raw: string, now: Date = new Date()): VersionResult {
  const release = knownRelease(product, raw);
  if (!release) return { kind: 'notFound' };
  if (release.version !== decodeURIComponent(raw)) return { kind: 'redirect', version: release.version };
  const status = computeStatus(product, { productId: product.id, version: release.version }, undefined, now);
  const fixes = Object.fromEntries(
    status.affecting.map((adv) => [adv.id, fixedIn(product, release.version, adv.affected)]),
  );
  return { kind: 'page', view: { release, status, fixes } };
}

function emptyCounts(): Record<ItemType, number> {
  return { security: 0, breaking: 0, deprecated: 0, feature: 0, fix: 0, other: 0 };
}

/** JSON for a <script type="application/ld+json">, safe to inline in HTML. */
export const jsonLd = (data: unknown): string => JSON.stringify(data).replaceAll('<', '\\u003c');

/** The whole structured-data tag, for {@html} in <svelte:head>. */
export const jsonLdScript = (data: unknown): string =>
  `<script type="application/ld+json">${jsonLd(data)}</script>`;
