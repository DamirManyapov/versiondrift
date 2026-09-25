// Feed JSON (docs/03-feed-format.md): what the collector publishes and every client reads.
import { z } from 'zod';

export const ITEM_TYPES = ['security', 'breaking', 'deprecated', 'feature', 'fix', 'other'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/**
 * Who decided an item's type (CLAUDE.md: every automatic judgement is labelled): a release-note heading, a keyword
 * rule, an LLM, a human, a linked advisory — or `default` when nothing matched and the item stays `other`.
 */
export const CLASSIFIED_BY = ['section', 'keyword', 'llm', 'manual', 'advisory', 'default'] as const;
export type ClassifiedBy = (typeof CLASSIFIED_BY)[number];

export const ChangeItem = z.strictObject({
  type: z.enum(ITEM_TYPES),
  /** One bullet, at most 300 characters, as the vendor wrote it (trimmed, links reduced to their text). */
  text: z.string().min(1).max(300),
  /** CVE / GHSA ids mentioned in the item. */
  refs: z.array(z.string()).optional(),
  classifiedBy: z.enum(CLASSIFIED_BY),
});
export type ChangeItem = z.output<typeof ChangeItem>;

// ── Product file: v1/products/<id>.json ─────────────────────────────────────────────────────────────────

/** 1.1 added FeedProduct.moduleHash. */
export const FEED_FORMAT_VERSION = '1.2';

const IsoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, { error: 'ISO 8601 UTC, e.g. 2026-09-22T00:00:00Z' });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FormatVersion = z.string().regex(/^1\.\d+$/);

export const Release = z.strictObject({
  /** As the vendor writes it, leading "v" stripped. */
  version: z.string().min(1),
  sortKey: z.string().min(1),
  track: z.string().nullable(),
  /** Release date; null when the source gives none. */
  date: IsoDateTime.nullable(),
  /** When the collector first saw this release (stands in for a missing date). */
  firstSeenAt: IsoDateTime,
  url: z.string().nullable(),
  prerelease: z.boolean(),
  items: z.array(ChangeItem),
  /** Items left out to keep at most 40 per release. */
  moreItems: z.int().min(1).optional(),
  summary: z.string().max(400).nullable(),
});
export type Release = z.output<typeof Release>;

export const Branch = z.strictObject({
  /** As the lifecycle source names it ("13.2", "12"); matched to releases by prefix. */
  id: z.string().min(1),
  codename: z.string().nullable(),
  releaseDate: IsoDate.nullable(),
  eol: z.boolean(),
  eolDate: IsoDate.nullable(),
  lts: z.boolean(),
  latest: z.string().nullable(),
});
export type Branch = z.output<typeof Branch>;

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const Advisory = z.strictObject({
  id: z.string().min(1),
  aliases: z.array(z.string()),
  title: z.string(),
  cvss: z
    .strictObject({ score: z.number().min(0).max(10), vector: z.string(), version: z.string() })
    .nullable(),
  severity: z.enum(SEVERITIES),
  kev: z.boolean(),
  published: IsoDateTime.nullable(),
  /** OSV semantics: `fixed` is an exclusive upper bound, `last_affected` an inclusive one. */
  affected: z.array(
    z.strictObject({
      introduced: z.string().optional(),
      fixed: z.string().optional(),
      last_affected: z.string().optional(),
      release: z.string().optional(),
    }),
  ),
  source: z.enum(['osv', 'ghsa', 'nvd', 'debian', 'vendor']),
  url: z.string(),
});
export type Advisory = z.output<typeof Advisory>;

export const FeedProduct = z.strictObject({
  formatVersion: FormatVersion,
  id: z.string().min(1),
  name: z.string().min(1),
  versionScheme: z.enum(['semver', 'loose', 'calver', 'debian', 'regex']),
  /** Only for versionScheme regex: clients need them to parse versions the same way. */
  versionRegex: z.string().optional(),
  branchGroups: z.int().min(1).optional(),
  tracks: z.array(z.strictObject({ id: z.string(), match: z.string(), label: z.string().optional() })),
  defaultTrack: z.string(),
  /** Human-facing links to where the data comes from. */
  sources: z.array(z.strictObject({ type: z.string(), url: z.string() })),
  branches: z.array(Branch),
  /** Newest first (by sortKey). */
  releases: z.array(Release),
  advisories: z.array(Advisory),
  collectedAt: IsoDateTime,
  lastSuccessAt: IsoDateTime.nullable(),
  stale: z.boolean(),
  /**
   * Hash of the module definition and classifier version that produced the items (since 1.1). When it changes,
   * items of releases the source still offers are recomputed; otherwise published items never change.
   */
  moduleHash: z.string().optional(),
});
export type FeedProduct = z.output<typeof FeedProduct>;

// ── v1/index.json ───────────────────────────────────────────────────────────────────────────────────────

export const IndexEntry = z.strictObject({
  name: z.string(),
  category: z.string(),
  latest: z.string().nullable(),
  latestDate: IsoDateTime.nullable(),
  /** Latest release per track. */
  tracks: z.record(z.string(), z.string()),
  maxSeverityLast30d: z.enum(SEVERITIES).nullable(),
  hasSecuritySource: z.boolean(),
  updatedAt: IsoDateTime,
  stale: z.boolean(),
  /** sha256 (hex) of the product file bytes, so a signed index vouches for every product file. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  url: z.string(),
});
export type IndexEntry = z.output<typeof IndexEntry>;

export const FeedIndex = z.strictObject({
  formatVersion: FormatVersion,
  generatedAt: IsoDateTime,
  collectorVersion: z.string(),
  products: z.record(z.string(), IndexEntry),
});
export type FeedIndex = z.output<typeof FeedIndex>;

// ── v1/catalog.json, v1/health.json, v1/week/<isoYear>-W<ww>.json ───────────────────────────────────────

export const Catalog = z.strictObject({
  formatVersion: FormatVersion,
  generatedAt: IsoDateTime,
  products: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      vendor: z.string().optional(),
      homepage: z.string().optional(),
      logo: z.string().optional(),
      description: z.string().optional(),
      aliases: z.array(z.string()).optional(),
    }),
  ),
});
export type Catalog = z.output<typeof Catalog>;

export const HealthEntry = z.strictObject({
  status: z.enum(['ok', 'failed']),
  lastAttemptAt: IsoDateTime,
  lastSuccessAt: IsoDateTime.nullable(),
  consecutiveFailures: z.int().min(0),
  releases: z.int().min(0),
  error: z.string().optional(),
  warnings: z.array(z.string()),
});
export type HealthEntry = z.output<typeof HealthEntry>;

export const Health = z.strictObject({
  formatVersion: FormatVersion,
  generatedAt: IsoDateTime,
  /** Share of modules whose last collection succeeded, 0–1. */
  ok: z.number().min(0).max(1),
  modules: z.record(z.string(), HealthEntry),
});
export type Health = z.output<typeof Health>;

export const WeekDigest = z.strictObject({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  from: IsoDate,
  to: IsoDate,
  entries: z.array(
    z.strictObject({
      product: z.string(),
      version: z.string(),
      date: IsoDateTime,
      types: z.array(z.enum(ITEM_TYPES)),
      maxSeverity: z.enum(SEVERITIES).nullable(),
    }),
  ),
});
export type WeekDigest = z.output<typeof WeekDigest>;

// ── v1/versions.json (since 1.2) ─────────────────────────────────────────────────────────────────────────

/** Versions worth a page of their own (sitemap, links) without downloading every product file. */
export const Versions = z.strictObject({
  formatVersion: FormatVersion,
  generatedAt: IsoDateTime,
  products: z.record(
    z.string(),
    z.strictObject({
      /** The newest stable releases, newest first. */
      recent: z.array(z.string()),
      /** The newest stable release of every lifecycle branch, newest first. */
      branches: z.array(z.string()),
      /** Whether the recent releases carry change items (a comparison page has something to show). */
      notes: z.boolean(),
    }),
  ),
});
export type Versions = z.output<typeof Versions>;
