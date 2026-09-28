// Fleet status model (docs/specs/fleet-ui.md §4): self-hosted hosts carry product instances, each with a version
// status from the engine, and a poll state of their own. The two axes stay separate: a host that can't be polled
// shows as "no connection" instead of "behind", but a host that was critical at the last contact stays critical.
import type { FeedProduct } from '@versiondrift/schema';
import { parse } from './version.ts';
import { computeStatus, DEFAULT_SETTINGS, specOf, type Installed, type StatusSettings } from './status.ts';

/**
 * How the last poll of a host went (docs/07): `pending` never polled; `unreachable` no answer; `auth-failed` the
 * profile's login was refused; `unknown` answered but the versions could not be read; `none` no access profile, the
 * versions are typed by hand.
 */
export type PollState = 'pending' | 'ok' | 'unreachable' | 'auth-failed' | 'unknown' | 'none';

/** Version status of one product instance; `unknown` when the version could not be read or placed. */
export type VersionStatus = 'critical' | 'eol' | 'update' | 'ok' | 'unknown';

/** What a host or an aggregate shows: a version status, or why there is none to show. */
export type FleetStatus = VersionStatus | 'stale' | 'pending';

export interface FleetInstance {
  productId: string;
  version: string;
  status: VersionStatus;
  /** Track (line) the version is in, or null for products without lines. */
  track: string | null;
  /** Newest release of that line. */
  latest: string | null;
  /** Releases newer than the version in its line. */
  behind: number;
  /** Highest CVSS among advisories affecting the version (critical). */
  cvss?: number;
  /** Advisories affecting the version, and how many of them are known exploited. */
  advisories: number;
  exploited: number;
  sortKey: string | null;
  source: 'detected' | 'manual';
}

export interface FleetHost {
  id: string;
  poll: { state: PollState; since?: string | null };
  instances: FleetInstance[];
}

/** Worst first. `unknown` ranks above `ok`: something needs a look, though nothing is known to be wrong. */
export const VERSION_RANK: Record<VersionStatus, number> = {
  critical: 0,
  eol: 1,
  update: 2,
  unknown: 3,
  ok: 4,
};

/** The poll states in which the last known versions may be out of date. */
export const pollBroken = (state: PollState): boolean => state === 'unreachable' || state === 'auth-failed';

/** A product instance as the fleet sees it, from the engine's status of that version. */
export function fleetInstance(
  product: FeedProduct,
  installed: Installed & { version: string },
  source: FleetInstance['source'] = 'detected',
  settings: StatusSettings = DEFAULT_SETTINGS,
  now: Date = new Date(),
): FleetInstance {
  const s = computeStatus(product, installed, settings, now);
  const status: VersionStatus =
    s.status === 'critical' || s.status === 'eol' || s.status === 'update' || s.status === 'ok'
      ? s.status
      : 'unknown';
  const parsed = parse(specOf(product), installed.version);
  return {
    productId: product.id,
    version: s.installed ?? installed.version,
    status,
    track: s.track === 'latest' ? null : s.track,
    latest: s.latest,
    behind: s.newer.length,
    ...(s.maxCvss !== undefined && { cvss: s.maxCvss }),
    advisories: s.affecting.length,
    exploited: s.affecting.filter((a) => a.kev).length,
    sortKey: parsed?.sortKey ?? null,
    source,
  };
}

/** Worst instance: by status, then the higher CVSS, then the further behind. */
export function worstInstance(instances: readonly FleetInstance[]): FleetInstance | undefined {
  return [...instances].sort(
    (a, b) =>
      VERSION_RANK[a.status] - VERSION_RANK[b.status] || (b.cvss ?? 0) - (a.cvss ?? 0) || b.behind - a.behind,
  )[0];
}

export interface HostStatus {
  status: FleetStatus;
  /** The instance that decides it, when there is one. */
  worst?: FleetInstance;
}

/**
 * A host's status (spec §4): never polled → pending; no data → stale (or pending before the first poll); a broken
 * poll hides a non-critical worst version behind stale; otherwise the worst version status.
 */
export function hostStatus(host: FleetHost): HostStatus {
  const worst = worstInstance(host.instances);
  if (!worst) {
    if (pollBroken(host.poll.state)) return { status: 'stale' };
    return { status: host.poll.state === 'unknown' ? 'unknown' : 'pending' };
  }
  if (pollBroken(host.poll.state) && worst.status !== 'critical') return { status: 'stale', worst };
  return { status: worst.status, worst };
}

export type AggregateKey = VersionStatus | 'stale';
export const AGGREGATE_KEYS: AggregateKey[] = ['critical', 'eol', 'update', 'unknown', 'ok', 'stale'];

export interface AggregateEntry<H extends FleetHost = FleetHost> {
  host: H;
  instance: FleetInstance;
  /** The instance's status, or stale when its host can't be polled and it isn't critical. */
  key: AggregateKey;
}

export interface ProductAggregate<H extends FleetHost = FleetHost> {
  productId: string;
  entries: AggregateEntry<H>[];
  counts: Record<AggregateKey, number>;
  /** Worst of critical, eol, update, unknown, ok; stale only when every instance is. */
  status: AggregateKey;
  hosts: number;
}

/** One product over the hosts that run it (spec §4 "Product aggregate"). */
export function productAggregate<H extends FleetHost>(
  productId: string,
  hosts: readonly H[],
): ProductAggregate<H> | undefined {
  const entries: AggregateEntry<H>[] = [];
  for (const host of hosts)
    for (const instance of host.instances) {
      if (instance.productId !== productId) continue;
      const key: AggregateKey =
        pollBroken(host.poll.state) && instance.status !== 'critical' ? 'stale' : instance.status;
      entries.push({ host, instance, key });
    }
  if (entries.length === 0) return undefined;
  const counts = Object.fromEntries(AGGREGATE_KEYS.map((k) => [k, 0])) as Record<AggregateKey, number>;
  for (const e of entries) counts[e.key]++;
  const status = AGGREGATE_KEYS.find((k) => k !== 'stale' && counts[k] > 0) ?? 'stale';
  return { productId, entries, counts, status, hosts: new Set(entries.map((e) => e.host.id)).size };
}

/** Every product on these hosts, aggregated. */
export function fleetAggregates<H extends FleetHost>(hosts: readonly H[]): ProductAggregate<H>[] {
  const ids = [...new Set(hosts.flatMap((h) => h.instances.map((i) => i.productId)))];
  return ids.map((id) => productAggregate(id, hosts)).filter((a) => a !== undefined);
}

const byKey = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');

export interface LineRow {
  track: string | null;
  latest: string | null;
  /** Lowest and highest version on the hosts. */
  min: string;
  max: string;
  count: number;
  /** Worst status in the line. */
  status: AggregateKey;
}

/**
 * The aggregate per line (tile rows "12 bookworm · 12.12–12.15 → 12.15 · ×7"), in the product's track order, lines
 * without a track last.
 */
export function lineRows(aggregate: ProductAggregate, trackOrder: readonly string[] = []): LineRow[] {
  const lines = new Map<string | null, AggregateEntry[]>();
  for (const e of aggregate.entries) lines.set(e.instance.track, [...(lines.get(e.instance.track) ?? []), e]);
  const order = (t: string | null) =>
    t === null ? Infinity : trackOrder.indexOf(t) === -1 ? 1e6 : trackOrder.indexOf(t);
  return [...lines]
    .map(([track, list]) => {
      const sorted = [...list].sort((a, b) => byKey(a.instance.sortKey, b.instance.sortKey));
      return {
        track,
        latest: list[0]!.instance.latest,
        min: sorted[0]!.instance.version,
        max: sorted[sorted.length - 1]!.instance.version,
        count: list.length,
        status: AGGREGATE_KEYS.find((k) => list.some((e) => e.key === k)) ?? 'stale',
      };
    })
    .sort((a, b) => order(a.track) - order(b.track));
}

export interface VersionGroup<H extends FleetHost = FleetHost> {
  track: string | null;
  version: string;
  latest: string | null;
  instance: FleetInstance;
  /** Status of the version itself (every host on it shares it). */
  status: VersionStatus;
  entries: AggregateEntry<H>[];
}

/** "Разбивка по версиям": one group per (line, version), lines in track order, newest version first. */
export function versionBreakdown<H extends FleetHost>(
  aggregate: ProductAggregate<H>,
  trackOrder: readonly string[] = [],
): VersionGroup<H>[] {
  const groups = new Map<string, VersionGroup<H>>();
  for (const e of aggregate.entries) {
    const key = `${e.instance.track ?? ''}\u0000${e.instance.sortKey ?? e.instance.version}`;
    const group = groups.get(key);
    if (group) group.entries.push(e);
    else
      groups.set(key, {
        track: e.instance.track,
        version: e.instance.version,
        latest: e.instance.latest,
        instance: e.instance,
        status: e.instance.status,
        entries: [e],
      });
  }
  const order = (t: string | null) =>
    t === null ? Infinity : trackOrder.indexOf(t) === -1 ? 1e6 : trackOrder.indexOf(t);
  return [...groups.values()].sort(
    (a, b) => order(a.track) - order(b.track) || byKey(b.instance.sortKey, a.instance.sortKey),
  );
}

export type SummaryKey = 'critical' | 'eol' | 'update' | 'ok';

/** The board's summary strip: products per status, and hosts whose poll is broken. */
export function fleetSummary(
  aggregates: readonly ProductAggregate[],
  hosts: readonly FleetHost[],
): Record<SummaryKey, number> & { pollProblems: number } {
  const out = { critical: 0, eol: 0, update: 0, ok: 0, pollProblems: 0 };
  for (const a of aggregates) if (a.status in out && a.status !== 'unknown') out[a.status as SummaryKey]++;
  out.pollProblems = hosts.filter((h) => pollBroken(h.poll.state)).length;
  return out;
}
