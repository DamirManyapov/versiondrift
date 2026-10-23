import type { RawAdvisory } from '@versiondrift/adapters';
import { parse } from '@versiondrift/core';
import type { Module, Release } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import {
  linkAdvisories,
  mergeAdvisories,
  noteAdvisories,
  perBranchRanges,
  ratingIn,
  severityFixedIn,
} from '../src/advisories.ts';

const adv = (extra: Partial<RawAdvisory>): RawAdvisory => ({
  id: 'CVE-2026-0001',
  aliases: [],
  title: 'XSS',
  cvss: null,
  severity: 'unknown',
  kev: false,
  published: '2026-09-01T00:00:00Z',
  affected: [],
  source: 'nvd',
  url: 'https://nvd.test',
  ...extra,
});

describe('mergeAdvisories', () => {
  it('merges by CVE id and aliases, preferring GHSA ranges and the first CVSS', () => {
    const merged = mergeAdvisories(
      [
        [
          adv({
            cvss: { score: 7.5, vector: 'nvd', version: '3.1' },
            severity: 'high',
            affected: [{ introduced: '0', fixed: '9.9' }],
          }),
        ],
        [
          adv({
            id: 'GHSA-aaaa-bbbb-cccc',
            aliases: ['CVE-2026-0001'],
            source: 'ghsa',
            url: 'https://gh.test',
            affected: [{ introduced: '1.0', fixed: '1.2' }],
            published: '2026-08-30T00:00:00Z',
          }),
        ],
      ],
      new Set(['CVE-2026-0001']),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'CVE-2026-0001',
      aliases: ['GHSA-aaaa-bbbb-cccc'],
      source: 'ghsa',
      url: 'https://gh.test',
      affected: [{ introduced: '1.0', fixed: '1.2' }],
      cvss: { score: 7.5 },
      kev: true,
      published: '2026-08-30T00:00:00Z',
    });
  });

  it('keeps separate vulnerabilities apart and newest first', () => {
    const merged = mergeAdvisories(
      [
        [
          adv({ id: 'CVE-1', published: '2026-01-01T00:00:00Z' }),
          adv({ id: 'CVE-2', published: '2026-02-01T00:00:00Z' }),
        ],
      ],
      new Set(),
    );
    expect(merged.map((a) => a.id)).toEqual(['CVE-2', 'CVE-1']);
  });
});

describe('perBranchRanges (advisoryRanges: per-branch)', () => {
  it('starts an upper bound without a lower one at its own line; other ranges stay', async () => {
    const { isAffected } = await import('@versiondrift/core');
    const [a] = perBranchRanges([
      {
        id: 'CVE-2026-12184',
        aliases: [],
        title: 'TLS DoS',
        cvss: null,
        severity: 'high',
        kev: false,
        published: null,
        affected: [
          { introduced: '0', fixed: '8.3.32' },
          { fixed: '8.4.21' },
          { introduced: '8.5.0', fixed: '8.5.6' },
          { introduced: '0', last_affected: '8.1.99' },
        ],
        source: 'ghsa',
        url: 'https://github.com/php/php-src/security/advisories/x',
      },
    ]);
    expect(a!.affected).toEqual([
      { introduced: '8.3.0', fixed: '8.3.32' },
      { introduced: '8.4.0', fixed: '8.4.21' },
      { introduced: '8.5.0', fixed: '8.5.6' },
      { introduced: '0', last_affected: '8.1.99' },
    ]);
    // 8.2 is not one of the listed lines: not affected; 8.3.31 is, 8.3.32 is fixed.
    expect(isAffected('semver', '8.2.35', a!.affected.slice(0, 3))).toBe(false);
    expect(isAffected('semver', '8.3.31', a!.affected)).toBe(true);
    expect(isAffected('semver', '8.3.32', a!.affected.slice(0, 3))).toBe(false);
  });
});

describe('linkAdvisories', () => {
  const module = { id: 'x', versionScheme: 'semver' } as Module;
  const release = (version: string, items: Release['items'] = []): Release => ({
    version,
    sortKey: parse('semver', version)!.sortKey,
    track: null,
    date: null,
    firstSeenAt: '2026-09-01T00:00:00Z',
    url: null,
    prerelease: false,
    items,
    summary: null,
  });
  const fix = adv({
    id: 'CVE-2026-0002',
    aliases: ['GHSA-x'],
    title: 'SQL injection',
    severity: 'critical',
    affected: [{ introduced: '1.0.0', fixed: '1.2.0' }],
  });

  it('lists exploited advisories first, then by score (an update may fix dozens)', () => {
    const scored = (id: string, score: number, kev = false) =>
      adv({ ...fix, id, aliases: [], kev, cvss: { score, vector: '', version: '3.1' } });
    const [fixed] = linkAdvisories(
      module,
      [release('1.2.0')],
      [scored('CVE-2026-0011', 7.5), scored('CVE-2026-0012', 9.8), scored('CVE-2026-0013', 7.8, true)],
    );
    expect(fixed?.items.map((i) => i.refs?.[0])).toEqual(['CVE-2026-0013', 'CVE-2026-0012', 'CVE-2026-0011']);
  });

  it('adds "Fixes CVE" to the fixing release unless its notes mention the CVE', () => {
    const [fixed, other] = linkAdvisories(module, [release('1.2.0'), release('1.1.0')], [fix]);
    expect(fixed?.items).toEqual([
      {
        type: 'security',
        text: 'Fixes CVE-2026-0002: SQL injection',
        refs: ['CVE-2026-0002', 'GHSA-x'],
        classifiedBy: 'advisory',
      },
    ]);
    expect(other?.items).toEqual([]);
    const mentioned = release('1.2.0', [
      { type: 'security', text: 'Fix GHSA-x', refs: ['GHSA-x'], classifiedBy: 'keyword' },
    ]);
    expect(linkAdvisories(module, [mentioned], [fix])[0]?.items).toHaveLength(1);
  });

  it('replaces advisory items from earlier runs', () => {
    const [once] = linkAdvisories(module, [release('1.2.0')], [fix]);
    const [twice] = linkAdvisories(module, [once!], [fix]);
    expect(twice?.items).toHaveLength(1);
    expect(linkAdvisories(module, [once!], [])[0]?.items).toEqual([]);
  });

  it('reports the highest severity fixed in a release', () => {
    expect(severityFixedIn(module, [fix], release('1.2.0'))).toBe('critical');
    expect(severityFixedIn(module, [fix], release('1.1.0'))).toBeNull();
  });
});

describe('advisories from release notes', () => {
  const release = (version: string, items: Release['items']): Release => ({
    version,
    sortKey: parse('semver', version)!.sortKey,
    track: null,
    date: `2026-10-0${version.at(-1)}T00:00:00Z`,
    firstSeenAt: '2026-10-01T00:00:00Z',
    url: `https://github.com/dani-garcia/vaultwarden/releases/tag/${version}`,
    prerelease: false,
    items,
    summary: null,
  });
  const security = (text: string, refs: string[]): Release['items'][number] => ({
    type: 'security',
    text,
    refs,
    classifiedBy: 'section',
  });

  it('reads a rating next to a severity word or "CVSS", not a version or a vector', () => {
    expect(ratingIn('Organization member revocation GHSA-69q9-v8p6-xvx3 (High, 8.1)')).toEqual({
      score: 8.1,
      severity: 'high',
    });
    expect(ratingIn('CVE-2026-1234 (CVSS base score: 6.6)')).toEqual({ score: 6.6 });
    expect(ratingIn('CVE-2026-1234, CVSS 3.1 base score 7.5')).toEqual({ score: 7.5 });
    expect(ratingIn('CVE-2026-1234 CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeUndefined();
    expect(ratingIn('Fix CVE-2026-1234 (moderate)')).toEqual({ severity: 'medium' });
    expect(ratingIn('Fix CVE-2026-1234 in 8.1.2')).toBeUndefined();
  });

  it('makes a vendor advisory for a rated fix whose advisory is not public yet (Vaultwarden 1.37.4)', () => {
    const releases = [
      release('1.37.4', [
        security('Organization member revocation GHSA-69q9-v8p6-xvx3 (High, 8.1)', ['GHSA-69q9-v8p6-xvx3']),
        security('Attachments GHSA-q5x6-grh5-fqgc (Medium, 6.5)', ['GHSA-q5x6-grh5-fqgc']),
        security('Additional dependency updates and minor security enhancements', []),
      ]),
      release('1.37.3', []),
    ];
    const [revocation, attachments, ...rest] = noteAdvisories(releases, [], new Set());
    expect(rest).toEqual([]);
    expect(revocation).toEqual({
      id: 'GHSA-69q9-v8p6-xvx3',
      aliases: [],
      title: 'Organization member revocation',
      cvss: { score: 8.1, vector: '', version: '' },
      severity: 'high',
      kev: false,
      published: '2026-10-04T00:00:00Z',
      affected: [{ introduced: '0', fixed: '1.37.4' }],
      source: 'vendor',
      url: 'https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.4',
    });
    expect(attachments?.severity).toBe('medium');
  });

  it('skips ids a security source knows, unrated items, several vulnerabilities and CVEs without a GHSA', () => {
    const releases = [
      release('1.2.1', [
        security('Fix GHSA-aaaa-bbbb-cccc (High, 7.5)', ['GHSA-aaaa-bbbb-cccc']),
        security('Fix GHSA-dddd-eeee-ffff', ['GHSA-dddd-eeee-ffff']),
        security('Fix GHSA-gggg-hhhh-jjjj and GHSA-kkkk-mmmm-nnnn (CVSS 9.8)', [
          'GHSA-gggg-hhhh-jjjj',
          'GHSA-kkkk-mmmm-nnnn',
        ]),
        security('CVE-2026-46860: A vulnerability in MySQL Router (CVSS 3.1 Base Score 9.8)', [
          'CVE-2026-46860',
        ]),
      ]),
    ];
    const known = mergeAdvisories([[adv({ id: 'GHSA-aaaa-bbbb-cccc', source: 'ghsa' })]], new Set());
    expect(noteAdvisories(releases, known, new Set())).toEqual([]);
  });

  it('gives a fix named in several releases one range per release (backports), dated by the first', () => {
    const item = security('Fix GHSA-pppp-qqqq-rrrr / CVE-2026-0005 (Critical, 9.1)', [
      'CVE-2026-0005',
      'GHSA-pppp-qqqq-rrrr',
    ]);
    const [a] = noteAdvisories(
      [release('1.3.2', [item]), release('1.2.9', [item])],
      [],
      new Set(['CVE-2026-0005']),
    );
    expect(a?.id).toBe('GHSA-pppp-qqqq-rrrr');
    expect(a?.aliases).toEqual(['CVE-2026-0005']);
    expect(a?.affected).toEqual([
      { introduced: '0', fixed: '1.2.9' },
      { introduced: '0', fixed: '1.3.2' },
    ]);
    expect(a?.published).toBe('2026-10-09T00:00:00Z');
    expect(a?.kev).toBe(true);
  });
});
