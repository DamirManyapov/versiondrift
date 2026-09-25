import type { Advisory, FeedProduct, Release } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { changelog, computeStatus, isAffected, parse, worstStatus } from '../src/index.ts';

const NOW = new Date('2026-09-26T00:00:00Z');

function release(version: string, extra: Partial<Release> = {}): Release {
  const v = parse('semver', version)!;
  return {
    version,
    sortKey: v.sortKey,
    track: version.startsWith('13.') ? '13' : version.startsWith('12.') ? '12' : null,
    date: '2026-09-01T00:00:00Z',
    firstSeenAt: '2026-09-01T00:00:00Z',
    url: null,
    prerelease: false,
    items: [],
    summary: null,
    ...extra,
  };
}

const advisory: Advisory = {
  id: 'CVE-2026-0001',
  aliases: [],
  title: 'XSS',
  cvss: { score: 8.1, vector: 'CVSS:3.1/…', version: '3.1' },
  severity: 'high',
  kev: false,
  published: '2026-09-15T00:00:00Z',
  affected: [{ introduced: '13.0.0', fixed: '13.2.2' }],
  source: 'ghsa',
  url: 'https://example.test/adv',
};

function product(extra: Partial<FeedProduct> = {}): FeedProduct {
  const releases = [
    release('13.3.0-beta.1', { prerelease: true }),
    release('13.2.2', { items: [{ type: 'security', text: 'Fix CVE-2026-0001', classifiedBy: 'section' }] }),
    release('13.2.1', {
      items: [
        { type: 'fix', text: 'x', classifiedBy: 'section' },
        { type: 'feature', text: 'y', classifiedBy: 'section' },
      ],
    }),
    release('13.1.0'),
    release('12.4.11', { items: [{ type: 'fix', text: 'z', classifiedBy: 'section' }] }),
    release('12.4.10'),
    release('12.4.9'),
  ];
  return {
    formatVersion: '1.1',
    id: 'grafana',
    name: 'Grafana',
    versionScheme: 'semver',
    tracks: [
      { id: '13', match: '^13\\.' },
      { id: '12', match: '^12\\.' },
    ],
    defaultTrack: 'latest',
    sources: [],
    branches: [
      {
        id: '13.2',
        codename: null,
        releaseDate: '2026-08-18',
        eol: false,
        eolDate: '2026-11-18',
        lts: false,
        latest: '13.2.2',
      },
      { id: '13', codename: null, releaseDate: null, eol: false, eolDate: null, lts: false, latest: null },
      {
        id: '12.4',
        codename: null,
        releaseDate: '2025-10-01',
        eol: true,
        eolDate: '2026-07-01',
        lts: false,
        latest: '12.4.11',
      },
    ],
    releases,
    advisories: [advisory],
    collectedAt: '2026-09-25T02:00:00Z',
    lastSuccessAt: '2026-09-25T02:00:00Z',
    stale: false,
    ...extra,
  };
}

const status = (version: string | undefined, extra: { track?: string } = {}, p = product()) =>
  computeStatus(
    p,
    { productId: 'grafana', ...(version !== undefined && { version }), ...extra },
    undefined,
    NOW,
  );

describe('computeStatus', () => {
  it('without a version: news, with the latest stable release', () => {
    expect(status(undefined)).toMatchObject({ status: 'news', latest: '13.2.2', track: 'latest', flags: [] });
  });

  it('on the latest release: ok', () => {
    expect(status('13.2.2')).toMatchObject({
      status: 'ok',
      track: '13',
      latest: '13.2.2',
      newer: [],
      flags: ['eolSoon'],
    });
  });

  it('affected by a high-CVSS advisory: critical, with the fix among the newer releases', () => {
    const s = status('v13.2.1');
    expect(s).toMatchObject({ status: 'critical', installed: '13.2.1', maxCvss: 8.1 });
    expect(s.affecting.map((a) => a.id)).toEqual(['CVE-2026-0001']);
    expect(s.newer.map((r) => r.version)).toEqual(['13.2.2']);
    expect(s.counts.security).toBe(1);
  });

  it('below the CVSS threshold the same version is just an update', () => {
    const s = computeStatus(
      product(),
      { productId: 'grafana', version: '13.2.1' },
      { criticalCvss: 9, treatKevAsCritical: true, eolWarnDays: 90 },
      NOW,
    );
    expect(s.status).toBe('update');
    expect(s.affecting).toHaveLength(1);
  });

  it('infers the track from the version, reports EOL and a newer major', () => {
    const s = status('12.4.10');
    expect(s).toMatchObject({ status: 'eol', track: '12', latest: '12.4.11', newestOverall: '13.2.2' });
    expect(s.branch?.id).toBe('12.4');
    expect(s.newer.map((r) => r.version)).toEqual(['12.4.11']);
    expect(s.flags).toContain('otherTrackNewer');
  });

  it('an explicit track wins over inference', () => {
    const s = status('12.4.11', { track: 'latest' });
    expect(s.newer.map((r) => r.version)).toEqual(['13.2.2', '13.2.1', '13.1.0']);
  });

  it('picks the most specific lifecycle branch and warns before EOL', () => {
    const s = status('13.2.2');
    expect(s.branch?.id).toBe('13.2');
    expect(s.flags).toEqual(['eolSoon']);
  });

  it('flags versions that are not in the feed or do not parse', () => {
    expect(status('13.2.0').flags).toContain('unknownVersion');
    expect(status('13.2.0').newer.map((r) => r.version)).toEqual(['13.2.2', '13.2.1']);
    expect(status('latest')).toMatchObject({
      status: 'news',
      installed: 'latest',
      flags: ['invalidVersion'],
    });
  });

  it('never counts pre-releases as updates', () => {
    expect(status('13.2.2').newer).toEqual([]);
  });

  it('is stale only when collection has been failing for more than 7 days', () => {
    expect(
      status('13.2.2', {}, product({ stale: true, lastSuccessAt: '2026-09-15T00:00:00Z' })),
    ).toMatchObject({
      status: 'stale',
      flags: ['staleData', 'eolSoon'],
    });
    expect(status('13.2.2', {}, product({ stale: true, lastSuccessAt: '2026-09-23T00:00:00Z' })).status).toBe(
      'ok',
    );
  });

  it('treats a KEV advisory as critical regardless of score', () => {
    const kev = {
      ...advisory,
      cvss: { score: 5, vector: '', version: '3.1' },
      severity: 'medium' as const,
      kev: true,
    };
    expect(status('13.2.1', {}, product({ advisories: [kev] })).status).toBe('critical');
  });
});

describe('isAffected', () => {
  it.each([
    ['13.1.0', [{ introduced: '13.0.0', fixed: '13.2.2' }], true],
    ['13.2.2', [{ introduced: '13.0.0', fixed: '13.2.2' }], false],
    ['12.9.9', [{ introduced: '13.0.0', fixed: '13.2.2' }], false],
    ['1.0.0', [{ introduced: '0', fixed: '1.0.1' }], true],
    ['1.0.1', [{ introduced: '0', last_affected: '1.0.1' }], true],
    ['1.0.2', [{ introduced: '0', last_affected: '1.0.1' }], false],
    ['1.0.0', [{ introduced: 'garbage', fixed: '2.0.0' }], false],
    ['1.0.0', [{}], false],
  ])('%s in %j → %s', (version, ranges, expected) => {
    expect(isAffected('semver', version, ranges)).toBe(expected);
  });
});

describe('changelog', () => {
  it('lists releases in (from, to] of the track and the advisories fixed there', () => {
    const log = changelog(product(), '13.1.0', '13.2.2');
    expect(log.releases.map((r) => r.version)).toEqual(['13.2.2', '13.2.1']);
    expect(log.fixedAdvisories.map((a) => a.id)).toEqual(['CVE-2026-0001']);
    expect(changelog(product(), '12.4.9', '13.2.2', '12').releases.map((r) => r.version)).toEqual([
      '12.4.11',
      '12.4.10',
    ]);
  });
});

describe('worstStatus', () => {
  it('orders critical > eol > update > ok > stale > news', () => {
    expect(worstStatus(['ok', 'update', 'eol'])).toBe('eol');
    expect(worstStatus(['news', 'ok'])).toBe('ok');
    expect(worstStatus([])).toBe('news');
  });
});
