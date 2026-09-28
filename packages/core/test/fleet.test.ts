import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FeedProduct } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import {
  fleetAggregates,
  fleetInstance,
  fleetSummary,
  hostStatus,
  lineRows,
  parse,
  productAggregate,
  versionBreakdown,
  type FleetHost,
  type PollState,
  type VersionStatus,
} from '../src/index.ts';

// The design's demo fleet (docs/specs/fleet-ui.md §10): 31 hosts, 2 sites, statuses the engine produced on
// 2026-09-28. Here the expected statuses are the input; the aggregation must reproduce the numbers in spec §5.A.
interface DemoProduct {
  product: string;
  version: string;
  line: string;
  source: 'detected' | 'manual';
  expected: { status: VersionStatus; cvss?: number; releasesBehind?: number };
}
interface DemoHost {
  id: string;
  site: string;
  poll: { state: string; since: string | null };
  products: DemoProduct[];
}
const demo = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../../../fixtures/fleet-demo.json'), 'utf8'),
) as { hosts: DemoHost[]; productLines: Record<string, { lines: Record<string, { latest: string }> }> };

const PRODUCT: Record<string, string> = {
  windows: 'windows-server',
  pve: 'proxmox-ve',
  pbs: 'proxmox-backup-server',
  docker: 'docker-engine',
};
const TRACK: Record<string, string> = { '7s': '7-stable', '7lt': '7-long-term', '6lt': '6-long-term' };
const POLL: Record<string, PollState> = { denied: 'auth-failed', timeout: 'unreachable' };

const hosts: (FleetHost & { site: string })[] = demo.hosts.map((h) => ({
  id: h.id,
  site: h.site,
  poll: { state: POLL[h.poll.state] ?? (h.poll.state as PollState), since: h.poll.since },
  instances: h.products.map((p) => ({
    productId: PRODUCT[p.product] ?? p.product,
    version: p.version,
    status: p.expected.status,
    track: TRACK[p.line] ?? p.line,
    latest: demo.productLines[p.product]!.lines[p.line]!.latest,
    behind: p.expected.releasesBehind ?? 0,
    ...(p.expected.cvss !== undefined && { cvss: p.expected.cvss }),
    advisories: 0,
    exploited: 0,
    sortKey: parse('loose', p.version)!.sortKey,
    source: p.source,
  })),
}));

const aggregate = (id: string, list = hosts) => productAggregate(id, list)!;

describe('fleet: the demo board (spec §5.A)', () => {
  it('Windows Server: critical, 7 hosts, 4 critical', () => {
    const a = aggregate('windows-server');
    expect(a).toMatchObject({ status: 'critical', hosts: 7 });
    expect(a.counts).toMatchObject({ critical: 4, ok: 3, stale: 0 });
  });

  it('Debian: EOL, 10 hosts, 3 behind, 1 EOL', () => {
    const a = aggregate('debian');
    expect(a).toMatchObject({ status: 'eol', hosts: 10 });
    expect(a.counts).toMatchObject({ eol: 1, update: 3, ok: 6 });
  });

  it('RouterOS: update, 10 hosts, 2 behind and 1 without connection', () => {
    const a = aggregate('routeros');
    expect(a).toMatchObject({ status: 'update', hosts: 10 });
    expect(a.counts).toMatchObject({ update: 2, ok: 7, stale: 1 });
  });

  it('PostgreSQL and Proxmox Backup Server are up to date; the rest is behind', () => {
    expect(aggregate('postgresql')).toMatchObject({ status: 'ok', hosts: 3 });
    expect(aggregate('proxmox-backup-server')).toMatchObject({ status: 'ok', hosts: 1 });
    for (const id of ['proxmox-ve', 'docker-engine', 'zabbix']) expect(aggregate(id).status).toBe('update');
  });

  it('summary strip: 1 critical, 1 EOL, 4 behind, 2 up to date products; 2 hosts with poll problems', () => {
    expect(fleetSummary(fleetAggregates(hosts), hosts)).toEqual({
      critical: 1,
      eol: 1,
      update: 4,
      ok: 2,
      pollProblems: 2,
    });
  });

  it('a site filter is just fewer hosts', () => {
    const msk = hosts.filter((h) => h.site === 'msk');
    expect(aggregate('windows-server', msk).counts).toMatchObject({ critical: 1, ok: 3 });
    expect(productAggregate('zabbix', msk)?.status).toBe('ok');
  });
});

describe('fleet: host status, two axes (spec §4)', () => {
  const host = (id: string) => hosts.find((h) => h.id === id)!;

  it('a host refusing the login stays red when it was critical at the last contact', () => {
    expect(hostStatus(host('kzn-fs-01'))).toMatchObject({ status: 'critical', worst: { cvss: 9.8 } });
  });

  it('an unreachable host that was only behind shows as stale, keeping its last version', () => {
    expect(hostStatus(host('kzn-gw-02'))).toMatchObject({ status: 'stale', worst: { version: '7.23.4' } });
  });

  it('the worst product decides: status, then CVSS, then how far behind', () => {
    expect(hostStatus(host('kzn-app-01'))).toMatchObject({ status: 'update', worst: { behind: 3 } });
    expect(hostStatus(host('msk-legacy-01')).status).toBe('eol');
  });

  it('no data yet: pending before the first poll, stale when the poll fails, unknown when unreadable', () => {
    const empty = (state: PollState): FleetHost => ({ id: 'x', poll: { state }, instances: [] });
    expect(hostStatus(empty('pending')).status).toBe('pending');
    expect(hostStatus(empty('unreachable')).status).toBe('stale');
    expect(hostStatus(empty('unknown')).status).toBe('unknown');
  });
});

describe('fleet: lines and versions', () => {
  it('line rows: per line the lowest and highest version and the latest, in track order', () => {
    expect(lineRows(aggregate('debian'), ['13', '12', '11'])).toEqual([
      { track: '13', latest: '13.7', min: '13.7', max: '13.7', count: 2, status: 'ok' },
      { track: '12', latest: '12.15', min: '12.12', max: '12.15', count: 7, status: 'update' },
      { track: '11', latest: '11.11', min: '11.11', max: '11.11', count: 1, status: 'eol' },
    ]);
  });

  it('version breakdown: one group per line and version, newest first, with its hosts', () => {
    const groups = versionBreakdown(aggregate('routeros'), ['7-long-term', '7-stable', '6-long-term']);
    expect(groups.map((g) => [g.track, g.version, g.entries.length])).toEqual([
      ['7-long-term', '7.23.7', 3],
      ['7-long-term', '7.23.4', 2],
      ['7-stable', '7.24.4', 2],
      ['6-long-term', '6.49.22', 2],
      ['6-long-term', '6.49.19', 1],
    ]);
    const behind = groups[1]!;
    expect(behind.entries.map((e) => [e.host.id, e.key])).toEqual([
      ['kzn-gw-01', 'update'],
      ['kzn-gw-02', 'stale'],
    ]);
  });
});

describe('fleetInstance', () => {
  const release = (version: string) => ({
    version,
    sortKey: parse('semver', version)!.sortKey,
    track: version.split('.')[0]!,
    date: '2026-09-01T00:00:00Z',
    firstSeenAt: '2026-09-01T00:00:00Z',
    url: null,
    prerelease: false,
    items: [],
    summary: null,
  });
  const product: FeedProduct = {
    formatVersion: '1.3',
    id: 'grafana',
    name: 'Grafana',
    versionScheme: 'semver',
    tracks: [
      { id: '13', match: '^13\\.' },
      { id: '12', match: '^12\\.' },
    ],
    defaultTrack: 'latest',
    sources: [],
    branches: [],
    releases: ['13.2.2', '13.2.1', '12.4.11', '12.4.10'].map(release),
    advisories: [],
    collectedAt: '2026-09-25T02:00:00Z',
    lastSuccessAt: '2026-09-25T02:00:00Z',
    stale: false,
  };
  const now = new Date('2026-09-26T00:00:00Z');

  it('reads the engine: status, line, the line latest and how far behind', () => {
    const inst = fleetInstance(
      product,
      { productId: 'grafana', version: '12.4.10' },
      'detected',
      undefined,
      now,
    );
    expect(inst).toMatchObject({
      status: 'update',
      track: '12',
      latest: '12.4.11',
      behind: 1,
      source: 'detected',
    });
  });

  it('an unreadable version is unknown, not news', () => {
    const inst = fleetInstance(
      product,
      { productId: 'grafana', version: 'build 5' },
      'manual',
      undefined,
      now,
    );
    expect(inst).toMatchObject({ status: 'unknown', sortKey: null, source: 'manual' });
  });
});
