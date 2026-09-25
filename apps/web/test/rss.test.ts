import { parse } from '@versiondrift/core';
import type { FeedIndex, FeedProduct, IndexEntry, WeekDigest } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { translator } from '../src/lib/i18n/index.ts';
import { parseIds, productItems, releaseItems, rssXml, weekItems } from '../src/lib/seo/rss.ts';

const ORIGIN = 'https://versiondrift.dev';
const entry = (name: string): IndexEntry => ({
  name,
  category: 'other',
  latest: null,
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
  products: { grafana: entry('Grafana'), k3s: entry('K3s') },
};
const digests: WeekDigest[] = [
  {
    week: '2026-W39',
    from: '2026-09-21',
    to: '2026-09-27',
    entries: [
      {
        product: 'grafana',
        version: '12.1.2',
        date: '2026-09-22T00:00:00Z',
        types: ['fix', 'security'],
        maxSeverity: 'high',
      },
      { product: 'k3s', version: '1.37.0+k3s1', date: '2026-09-23T00:00:00Z', types: [], maxSeverity: null },
    ],
  },
  { week: '2026-W38', from: '2026-09-14', to: '2026-09-20', entries: [] },
];

describe('rss', () => {
  it('product feed: one item per stable release, important items first, linked to version pages', () => {
    const product = {
      id: 'grafana',
      name: 'Grafana',
      versionScheme: 'semver',
      releases: [
        {
          version: '12.1.2',
          sortKey: parse('semver', '12.1.2')!.sortKey,
          track: null,
          date: '2026-09-22T00:00:00Z',
          firstSeenAt: '2026-09-22T00:00:00Z',
          url: 'https://github.com/grafana/grafana/releases/tag/v12.1.2',
          prerelease: false,
          items: [
            { type: 'fix', text: 'Fix <panel> & legend', classifiedBy: 'section' },
            { type: 'security', text: 'Fix CVE-2026-1', classifiedBy: 'section' },
          ],
          summary: null,
        },
      ],
    } as unknown as FeedProduct;
    const [item] = productItems(product, ORIGIN);
    expect(item?.title).toBe('Grafana 12.1.2 (security, fix)');
    expect(item?.link).toBe(`${ORIGIN}/p/grafana/v/12.1.2`);
    expect(item?.description.indexOf('security')).toBeLessThan(item?.description.indexOf('fix') ?? 0);
    expect(item?.description).toContain('Fix &lt;panel&gt; &amp; legend');
  });

  it('board feed: releases of the chosen products only', () => {
    const items = releaseItems(digests, index, ORIGIN, new Set(['k3s']));
    expect(items.map((i) => i.title)).toEqual(['K3s 1.37.0+k3s1']);
    expect(items[0]?.link).toBe(`${ORIGIN}/p/k3s/v/1.37.0%2Bk3s1`);
  });

  it('weekly feed: one item per non-empty week', () => {
    const items = weekItems(digests, index, ORIGIN, translator('en'));
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('2026-W39: 2 releases, 1 security fix');
    expect(items[0]?.link).toBe(`${ORIGIN}/week?w=2026-W39`);
  });

  it('writes RSS 2.0 with escaped content', () => {
    const xml = rssXml(
      { title: 'A & B', link: ORIGIN, description: 'd', self: `${ORIGIN}/rss/week.xml`, language: 'en' },
      releaseItems(digests, index, ORIGIN),
    );
    expect(xml).toContain('<title>A &amp; B</title>');
    expect(xml).toContain('<pubDate>Wed, 23 Sep 2026 00:00:00 GMT</pubDate>');
    expect(xml).toContain('<category>security</category>');
    expect(xml.match(/<item>/g)).toHaveLength(2);
  });

  it('accepts only module-like ids in board URLs', () => {
    expect(parseIds('grafana,k3s,grafana,<x>,')).toEqual(['grafana', 'k3s']);
  });
});
