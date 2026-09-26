import { describe, expect, it } from 'vitest';
import { trackOf } from '../src/index.ts';

const grafana = {
  tracks: [
    { id: '12', match: '^12\\.' },
    { id: '11', match: '^11\\.' },
    { id: 'any-11', match: '^11' },
  ],
};

describe('trackOf', () => {
  it('returns the first matching track, after stripping "v"', () => {
    expect(trackOf(grafana, '12.1.2')).toBe('12');
    expect(trackOf(grafana, 'v11.6.0')).toBe('11');
  });

  it('returns null when nothing matches or there are no tracks', () => {
    expect(trackOf(grafana, '10.4.0')).toBeNull();
    expect(trackOf({}, '1.0.0')).toBeNull();
  });
});

describe('update channels (overlapping tracks)', async () => {
  const { computeStatus, changelog, inTrack, parse } = await import('../src/index.ts');

  // MikroTik-like: long-term is the 7.23 branch, stable all of 7, testing adds release candidates.
  const rel = (version: string, prerelease = false) => ({
    version,
    sortKey: parse('loose', version)!.sortKey,
    track: null,
    date: '2026-09-01T00:00:00Z',
    firstSeenAt: '2026-09-01T00:00:00Z',
    url: null,
    prerelease,
    items: [],
    summary: null,
  });
  const routeros = {
    formatVersion: '1.3',
    id: 'routeros',
    name: 'RouterOS',
    versionScheme: 'loose' as const,
    tracks: [
      { id: 'long-term', match: '^7\\.23(\\.|$)', current: '7.23.7' },
      { id: 'stable', match: '^7\\.' },
      { id: 'testing', match: '^7\\.', prereleases: true },
      { id: '6', match: '^6\\.' },
    ],
    defaultTrack: 'stable',
    sources: [],
    branches: [],
    releases: [
      rel('7.25rc1', true),
      rel('7.24.4'),
      rel('7.24.3'),
      rel('7.23.7'),
      rel('7.23.5'),
      rel('6.49.22'),
    ],
    advisories: [],
    collectedAt: '2026-09-26T00:00:00Z',
    lastSuccessAt: '2026-09-26T00:00:00Z',
    stale: false,
  };

  it('puts a release in every track whose rule it meets', () => {
    expect(inTrack(routeros, 'long-term', rel('7.23.7'))).toBe(true);
    expect(inTrack(routeros, 'stable', rel('7.23.7'))).toBe(true);
    expect(inTrack(routeros, 'stable', rel('7.25rc1', true))).toBe(false);
    expect(inTrack(routeros, 'testing', rel('7.25rc1', true))).toBe(true);
    expect(inTrack(routeros, 'latest', rel('7.25rc1', true))).toBe(false);
  });

  it('judges a version by its channel: inferred, or pinned by the user', () => {
    const on = (version: string, track?: string) =>
      computeStatus(routeros, { productId: 'routeros', version, ...(track && { track }) });
    expect(on('7.23.7')).toMatchObject({
      track: 'long-term',
      status: 'ok',
      latest: '7.23.7',
      newestOverall: '7.24.4',
    });
    expect(on('7.23.5')).toMatchObject({ track: 'long-term', status: 'update', latest: '7.23.7' });
    expect(on('7.23.7', 'stable')).toMatchObject({ status: 'update', latest: '7.24.4' });
    expect(on('7.24.4', 'testing')).toMatchObject({ status: 'update', latest: '7.25rc1' });
    expect(on('6.49.22')).toMatchObject({ track: '6', status: 'ok' });
    // A channel the product no longer has (the old "7" track) is ignored, not an empty track.
    expect(on('7.23.7', '7')).toMatchObject({ track: 'long-term', status: 'ok' });
  });

  it('builds the changelog within the chosen channel', () => {
    expect(changelog(routeros, '7.23.5', '7.24.4', 'stable').releases.map((r) => r.version)).toEqual([
      '7.24.4',
      '7.24.3',
      '7.23.7',
    ]);
    expect(changelog(routeros, '7.23.5', '7.25rc1', 'long-term').releases.map((r) => r.version)).toEqual([
      '7.23.7',
    ]);
  });
});
