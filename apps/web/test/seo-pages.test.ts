import { parse } from '@versiondrift/core';
import type { Advisory, FeedProduct, ItemType, Release } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { compareView, jsonLd, knownRelease, versionView } from '../src/lib/seo/pages.ts';

const NOW = new Date('2026-09-26T00:00:00Z');
const rel = (version: string, types: ItemType[] = []): Release => ({
  version,
  sortKey: parse('semver', version)!.sortKey,
  track: null,
  date: '2026-09-01T00:00:00Z',
  firstSeenAt: '2026-09-01T00:00:00Z',
  url: `https://example.com/${version}`,
  prerelease: false,
  items: types.map((type) => ({ type, text: `${type} in ${version}`, classifiedBy: 'section' as const })),
  summary: null,
});
const adv = (id: string, affected: Advisory['affected'], score = 9.8): Advisory => ({
  id,
  aliases: [],
  title: id,
  cvss: { score, vector: '', version: '3.1' },
  severity: 'critical',
  kev: false,
  published: '2026-08-01T00:00:00Z',
  affected,
  source: 'ghsa',
  url: `https://example.com/${id}`,
});
const product: FeedProduct = {
  formatVersion: '1.1',
  id: 'grafana',
  name: 'Grafana',
  versionScheme: 'semver',
  tracks: [],
  defaultTrack: 'latest',
  sources: [],
  branches: [],
  releases: [
    rel('12.1.2', ['fix']),
    rel('12.1.0', ['feature', 'breaking']),
    rel('12.0.0', ['breaking', 'deprecated', 'security']),
    rel('11.3.2', ['security']),
    rel('11.3.1'),
  ],
  advisories: [
    adv('CVE-1', [{ introduced: '11.0.0', fixed: '11.3.2' }]),
    adv('CVE-2', [{ introduced: '12.1.0', fixed: '12.1.2' }], 5),
    adv('CVE-3', [{ introduced: '0', fixed: '13.0.0' }], 6),
  ],
  collectedAt: '',
  lastSuccessAt: '2026-09-25T00:00:00Z',
  stale: false,
};

describe('compare pages', () => {
  it('merges the releases in (from, to] and what the upgrade fixes', () => {
    const result = compareView(product, '11.3.1...12.1.2');
    expect(result.kind).toBe('page');
    if (result.kind !== 'page') return;
    const { view } = result;
    expect(view.releases.map((r) => r.version)).toEqual(['12.1.2', '12.1.0', '12.0.0', '11.3.2']);
    expect(view.counts).toMatchObject({ breaking: 2, security: 2, deprecated: 1, feature: 1, fix: 1 });
    expect(view.breaking.map((b) => b.version)).toEqual(['12.1.0', '12.0.0']);
    // CVE-1 affects 11.3.1 and not 12.1.2; CVE-2 never affected 11.3.1; CVE-3 still affects 12.1.2.
    expect(view.fixedAdvisories.map((a) => a.id)).toEqual(['CVE-1']);
  });

  it('redirects to the canonical order and spelling', () => {
    expect(compareView(product, '12.1.2...11.3.1')).toEqual({ kind: 'redirect', range: '11.3.1...12.1.2' });
    expect(compareView(product, 'v11.3.1...v12.1.2')).toEqual({ kind: 'redirect', range: '11.3.1...12.1.2' });
  });

  it('has no thin or invented pages', () => {
    expect(compareView(product, '11.3.1...99.0.0').kind).toBe('notFound');
    expect(compareView(product, '11.3.1...11.3.1').kind).toBe('notFound');
    expect(compareView(product, 'garbage').kind).toBe('notFound');
    // 11.3.1 → 11.3.2 has a security item; without items and fixes the page would be empty.
    const bare = { ...product, advisories: [], releases: product.releases.map((r) => ({ ...r, items: [] })) };
    expect(compareView(bare, '11.3.1...11.3.2').kind).toBe('notFound');
    expect(compareView(product, '11.3.1...11.3.2').kind).toBe('page');
  });
});

describe('version pages', () => {
  it('reports what affects a release and what is newer', () => {
    const result = versionView(product, '11.3.1', NOW);
    expect(result.kind).toBe('page');
    if (result.kind !== 'page') return;
    expect(result.view.status.status).toBe('critical');
    expect(result.view.status.affecting.map((a) => a.id)).toEqual(['CVE-1', 'CVE-3']);
    expect(result.view.fixes).toEqual({ 'CVE-1': '11.3.2', 'CVE-3': '13.0.0' });
    expect(result.view.status.newer).toHaveLength(4);
  });

  it('redirects spellings and rejects unknown versions', () => {
    expect(versionView(product, 'v12.1.2', NOW)).toEqual({ kind: 'redirect', version: '12.1.2' });
    expect(versionView(product, '10.0.0', NOW)).toEqual({ kind: 'notFound' });
    expect(knownRelease(product, 'v12.0.0')?.version).toBe('12.0.0');
  });
});

it('jsonLd cannot close the script tag', () => {
  expect(jsonLd({ name: '</script><script>alert(1)</script>' })).not.toContain('</script>');
});
