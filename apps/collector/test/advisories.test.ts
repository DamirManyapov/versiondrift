import type { RawAdvisory } from '@versiondrift/adapters';
import { parse } from '@versiondrift/core';
import type { Module, Release } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { linkAdvisories, mergeAdvisories, severityFixedIn } from '../src/advisories.ts';

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
