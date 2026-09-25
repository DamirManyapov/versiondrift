import type { FeedIndex, IndexEntry, Versions } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { sitemapUrls, sitemapXml } from '../src/lib/seo/sitemap.ts';

const entry = (latest: string): IndexEntry => ({
  name: 'x',
  category: 'other',
  latest,
  latestDate: null,
  tracks: {},
  maxSeverityLast30d: null,
  hasSecuritySource: true,
  updatedAt: '2026-09-25T02:00:00Z',
  stale: false,
  sha256: '0'.repeat(64),
  url: '',
});
const index: FeedIndex = {
  formatVersion: '1.2',
  generatedAt: '2026-09-25T02:00:00Z',
  collectorVersion: '0',
  products: { grafana: entry('12.1.2'), k3s: entry('1.37.0+k3s1') },
};
const versions: Versions = {
  formatVersion: '1.2',
  generatedAt: '2026-09-25T02:00:00Z',
  products: {
    grafana: { recent: ['12.1.2', '12.1.1'], branches: ['12.1.2', '11.6.4'], notes: true },
    k3s: { recent: ['1.37.0+k3s1', '1.36.2+k3s1'], branches: [], notes: false },
  },
};

describe('sitemap', () => {
  it('lists product and version pages, and comparisons only where notes exist', () => {
    const locs = sitemapUrls(index, versions, 'https://versiondrift.dev').map((u) => u.loc);
    expect(locs).toEqual([
      'https://versiondrift.dev/',
      'https://versiondrift.dev/catalog',
      'https://versiondrift.dev/p/grafana',
      'https://versiondrift.dev/p/grafana/v/12.1.2',
      'https://versiondrift.dev/p/grafana/v/12.1.1',
      'https://versiondrift.dev/p/grafana/12.1.1...12.1.2',
      'https://versiondrift.dev/p/grafana/v/11.6.4',
      'https://versiondrift.dev/p/grafana/11.6.4...12.1.2',
      'https://versiondrift.dev/p/k3s',
      'https://versiondrift.dev/p/k3s/v/1.37.0%2Bk3s1',
      'https://versiondrift.dev/p/k3s/v/1.36.2%2Bk3s1',
    ]);
  });

  it('works with feeds that predate versions.json', () => {
    expect(sitemapUrls(index, undefined, 'https://x.dev')).toHaveLength(4);
  });

  it('writes valid, escaped XML', () => {
    const xml = sitemapXml([{ loc: 'https://x.dev/a&b', lastmod: '2026-09-25' }]);
    expect(xml).toContain('<loc>https://x.dev/a&amp;b</loc><lastmod>2026-09-25</lastmod>');
    expect(xml.startsWith('<?xml')).toBe(true);
  });
});
