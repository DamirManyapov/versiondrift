import { parse } from '@versiondrift/core';
import type { FeedIndex, FeedProduct, Release } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { buildRows, filterRows, summarize } from '../src/lib/board/rows.ts';

const NOW = new Date('2026-09-26T00:00:00Z');
const rel = (version: string, date: string, types: ('security' | 'fix')[] = []): Release => ({
  version,
  sortKey: parse('semver', version)!.sortKey,
  track: null,
  date,
  firstSeenAt: date,
  url: null,
  prerelease: false,
  items: types.map((type) => ({ type, text: type, classifiedBy: 'section' as const })),
  summary: null,
});
const product = (id: string, releases: Release[], extra: Partial<FeedProduct> = {}): FeedProduct => ({
  formatVersion: '1.1',
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  versionScheme: 'semver',
  tracks: [],
  defaultTrack: 'latest',
  sources: [],
  branches: [],
  releases,
  advisories: [],
  collectedAt: '',
  lastSuccessAt: '2026-09-25T00:00:00Z',
  stale: false,
  ...extra,
});
const index = (ids: string[]): FeedIndex => ({
  formatVersion: '1.1',
  generatedAt: '',
  collectorVersion: '',
  products: Object.fromEntries(
    ids.map((id) => [
      id,
      {
        name: id[0]!.toUpperCase() + id.slice(1),
        category: id === 'zabbix' ? 'monitoring' : 'web',
        latest: null,
        latestDate: null,
        tracks: {},
        maxSeverityLast30d: null,
        hasSecuritySource: false,
        updatedAt: '',
        stale: false,
        sha256: '0'.repeat(64),
        url: '',
      },
    ]),
  ),
});

const products = {
  grafana: product('grafana', [
    rel('2.0.0', '2026-09-24T00:00:00Z', ['security', 'fix']),
    rel('1.0.0', '2026-01-01T00:00:00Z'),
  ]),
  zabbix: product('zabbix', [rel('7.0.1', '2026-08-01T00:00:00Z')]),
  nginx: product('nginx', [rel('1.2.0', '2026-08-01T00:00:00Z')], {
    branches: [
      {
        id: '1.1',
        codename: null,
        releaseDate: null,
        eol: true,
        eolDate: '2026-01-01',
        lts: false,
        latest: null,
      },
    ],
  }),
};

describe('buildRows', () => {
  const rows = buildRows(
    [
      { p: 'zabbix', ver: '7.0.1' },
      { p: 'grafana', ver: '1.0.0', label: 'a' },
      { p: 'grafana', ver: '2.0.0', label: 'b' },
      { p: 'nginx', ver: '1.1.9' },
      { p: 'outline' },
      { p: 'gone', ver: '1' },
    ],
    index(['grafana', 'zabbix', 'nginx', 'outline']),
    products,
    { criticalCvss: 7, hideOk: false },
    NOW,
  );

  it('groups instances per product, the worst one decides, and sorts by status then name', () => {
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual([
      'nginx:eol',
      'grafana:update',
      'gone:news',
      'outline:news',
      'zabbix:ok',
    ]);
    const grafana = rows.find((r) => r.id === 'grafana')!;
    expect(grafana.instances).toHaveLength(2);
    expect(grafana.primary?.item.label).toBe('a');
    expect(grafana.primary?.status.counts).toMatchObject({ security: 1, fix: 1 });
    expect(grafana.newThisWeek).toBe(true);
  });

  it('marks products missing from the feed', () => {
    expect(rows.find((r) => r.id === 'gone')?.known).toBe(false);
    expect(rows.find((r) => r.id === 'outline')?.known).toBe(true);
  });

  it('filters by status, category, text and hide-ok, and counts the summary', () => {
    const base = { query: '', hideOk: false };
    expect(filterRows(rows, { ...base, status: 'update' }).map((r) => r.id)).toEqual(['grafana']);
    expect(filterRows(rows, { ...base, category: 'monitoring' }).map((r) => r.id)).toEqual(['zabbix']);
    expect(filterRows(rows, { ...base, query: 'GRAF' }).map((r) => r.id)).toEqual(['grafana']);
    expect(filterRows(rows, { ...base, hideOk: true }).map((r) => r.id)).not.toContain('zabbix');
    expect(summarize(rows)).toEqual({ critical: 0, eol: 1, update: 1, ok: 1 });
  });
});
