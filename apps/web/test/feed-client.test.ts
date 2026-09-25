import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FeedClient, FeedError } from '../src/lib/feed/client.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const product = JSON.stringify({
  formatVersion: '1.1',
  id: 'grafana',
  name: 'Grafana',
  versionScheme: 'semver',
  tracks: [],
  defaultTrack: 'latest',
  sources: [],
  branches: [],
  releases: [],
  advisories: [],
  collectedAt: '2026-09-26T02:00:00Z',
  lastSuccessAt: '2026-09-26T02:00:00Z',
  stale: false,
});
const index = (hash: string) =>
  JSON.stringify({
    formatVersion: '1.1',
    generatedAt: '2026-09-26T02:00:00Z',
    collectorVersion: '0.1.0',
    products: {
      grafana: {
        name: 'Grafana',
        category: 'monitoring',
        latest: null,
        latestDate: null,
        tracks: {},
        maxSeverityLast30d: null,
        hasSecuritySource: false,
        updatedAt: '2026-09-26T02:00:00Z',
        stale: false,
        sha256: hash,
        url: 'products/grafana.json?v=abc',
      },
    },
  });

function server(files: Record<string, string[]>) {
  const requests: { url: string; headers: Record<string, string>; cache?: RequestCache }[] = [];
  const fetchFn = ((url: string, init: RequestInit = {}) => {
    requests.push({
      url,
      headers: init.headers as Record<string, string>,
      ...(init.cache && { cache: init.cache }),
    });
    const queue = files[url];
    const body = queue?.length && queue.length > 1 ? queue.shift()! : queue?.[0];
    if (body === undefined) return Promise.resolve(new Response('', { status: 404 }));
    if (body === '304') return Promise.resolve(new Response(null, { status: 304 }));
    return Promise.resolve(new Response(body, { headers: { etag: `"${sha(body).slice(0, 8)}"` } }));
  }) as typeof fetch;
  return { fetchFn, requests };
}

describe('FeedClient', () => {
  const base = 'https://feed.test/';

  it('loads the index once and verifies product files against it', async () => {
    const { fetchFn, requests } = server({
      'https://feed.test/v1/index.json': [index(sha(product))],
      'https://feed.test/v1/products/grafana.json?v=abc': [product],
    });
    const client = new FeedClient(base, fetchFn);
    expect((await client.product('grafana')).name).toBe('Grafana');
    await client.index();
    expect(requests.filter((r) => r.url.endsWith('index.json'))).toHaveLength(1);
  });

  it('refetches past a stale cache once, then fails loudly', async () => {
    const stale = product.replace('Grafana', 'Grafana (old)');
    const good = server({
      'https://feed.test/v1/index.json': [index(sha(product))],
      'https://feed.test/v1/products/grafana.json?v=abc': [stale, product],
    });
    expect((await new FeedClient(base, good.fetchFn).product('grafana')).name).toBe('Grafana');
    expect(good.requests.at(-1)?.cache).toBe('reload');

    const bad = server({
      'https://feed.test/v1/index.json': [index(sha(product))],
      'https://feed.test/v1/products/grafana.json?v=abc': [stale],
    });
    await expect(new FeedClient(base, bad.fetchFn).product('grafana')).rejects.toThrow(
      /does not match the index/,
    );
  });

  it('sends If-None-Match and serves 304 from memory', async () => {
    const catalog = JSON.stringify({
      formatVersion: '1.1',
      generatedAt: '2026-09-26T02:00:00Z',
      products: [],
    });
    const { fetchFn, requests } = server({ 'https://feed.test/v1/catalog.json': [catalog, '304'] });
    const client = new FeedClient(base, fetchFn);
    await client.catalog();
    expect(await client.catalog()).toMatchObject({ products: [] });
    expect(requests[1]?.headers['if-none-match']).toMatch(/^"/);
  });

  it('accepts a path base (self-hosted /feed/) and reports unknown products and missing weeks', async () => {
    const { fetchFn, requests } = server({ '/feed/v1/index.json': [index(sha(product))] });
    const client = new FeedClient('/feed', fetchFn);
    await expect(client.product('nope')).rejects.toBeInstanceOf(FeedError);
    expect(requests[0]?.url).toBe('/feed/v1/index.json');
    expect(await client.week('2026-W01')).toBeUndefined();
  });
});
