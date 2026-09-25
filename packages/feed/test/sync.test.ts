import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FeedIndex, IndexEntry } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { generateSigningKey, parseSecret, readSyncState, sha256, signFile, syncFeed } from '../src/index.ts';

const key = generateSigningKey();
const signing = parseSecret(key.secret);
const NOW = new Date('2026-09-26T03:00:00Z');

/** An upstream feed in memory: products by id, a signed index, ETags on the index. */
function upstream() {
  const products: Record<string, string> = {};
  let indexText = '';
  let signature = '';
  let etag = '';
  const requests: string[] = [];
  const publish = (generatedAt: string, tamper?: { id: string; text: string }) => {
    const entries: Record<string, IndexEntry> = {};
    for (const [id, text] of Object.entries(products)) {
      entries[id] = {
        name: id,
        category: 'other',
        latest: null,
        latestDate: null,
        tracks: {},
        maxSeverityLast30d: null,
        hasSecuritySource: false,
        updatedAt: generatedAt,
        stale: false,
        sha256: sha256(text),
        url: `products/${id}.json?v=${sha256(text).slice(0, 12)}`,
      };
    }
    const index: FeedIndex = {
      formatVersion: '1.2',
      generatedAt,
      collectorVersion: 'test',
      products: entries,
    };
    indexText = JSON.stringify(index);
    signature = signFile(indexText, signing, `generated ${generatedAt}`);
    etag = `"${sha256(indexText).slice(0, 16)}"`;
    if (tamper) products[tamper.id] = tamper.text;
  };
  const fetch = (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    const file = url.pathname.replace(/^\/v1\//, '');
    const headers = new Headers(init?.headers);
    if (file === 'index.json') {
      if (headers.get('if-none-match') === etag) return Promise.resolve(new Response(null, { status: 304 }));
      return Promise.resolve(new Response(indexText, { headers: { etag } }));
    }
    if (file === 'index.json.minisig') return Promise.resolve(new Response(signature));
    if (file === 'catalog.json') return Promise.resolve(Response.json({ products: [] }));
    const product = /^products\/(.+)\.json$/.exec(file)?.[1];
    if (product && products[product] !== undefined) return Promise.resolve(new Response(products[product]));
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
  return { products, publish, fetch, requests, forge: () => (signature = signature.replace(/\n(.)/, '\nA')) };
}

const options = async (feed: ReturnType<typeof upstream>) => ({
  source: 'https://feed.test/',
  dir: await mkdtemp(path.join(tmpdir(), 'vd-feed-')),
  publicKey: key.publicKey,
  fetch: feed.fetch as typeof fetch,
  now: NOW,
});

describe('syncFeed', () => {
  it('mirrors a signed feed, then only what changed', async () => {
    const feed = upstream();
    feed.products.grafana = '{"id":"grafana","v":1}';
    feed.products.nginx = '{"id":"nginx","v":1}';
    feed.publish('2026-09-26T02:00:00Z');
    const o = await options(feed);

    const first = await syncFeed(o);
    expect(first).toMatchObject({ changed: true, downloaded: 2, state: { verified: true, products: 2 } });
    expect(await readFile(path.join(o.dir, 'v1/products/grafana.json'), 'utf8')).toBe(feed.products.grafana);
    expect(await readFile(path.join(o.dir, 'v1/catalog.json'), 'utf8')).toContain('products');

    const again = await syncFeed(o);
    expect(again).toMatchObject({ changed: false, downloaded: 0 });

    feed.products.nginx = '{"id":"nginx","v":2}';
    delete feed.products.grafana;
    feed.publish('2026-09-27T02:00:00Z');
    feed.requests.length = 0;
    const third = await syncFeed(o);
    expect(third).toMatchObject({
      changed: true,
      downloaded: 1,
      state: { generatedAt: '2026-09-27T02:00:00Z' },
    });
    expect(feed.requests.filter((r) => r.includes('/products/'))).toEqual(['/v1/products/nginx.json']);
    expect(await readdir(path.join(o.dir, 'v1/products'))).toEqual(['nginx.json']);
  });

  it('refuses a feed whose signature or product hashes are wrong, keeping the mirror as it was', async () => {
    const feed = upstream();
    feed.products.grafana = '{"id":"grafana","v":1}';
    feed.publish('2026-09-26T02:00:00Z');
    const o = await options(feed);
    await syncFeed(o);
    const before = await readFile(path.join(o.dir, 'v1/index.json'), 'utf8');

    feed.products.grafana = '{"id":"grafana","v":2}';
    feed.publish('2026-09-27T02:00:00Z', { id: 'grafana', text: '{"id":"grafana","evil":true}' });
    await expect(syncFeed(o)).rejects.toThrow(/does not match the signed index/);
    expect(await readFile(path.join(o.dir, 'v1/index.json'), 'utf8')).toBe(before);
    expect(await readFile(path.join(o.dir, 'v1/products/grafana.json'), 'utf8')).toBe(
      '{"id":"grafana","v":1}',
    );
    expect(await readSyncState(o.dir)).toMatchObject({
      generatedAt: '2026-09-26T02:00:00Z',
      lastError: expect.stringMatching(/grafana/) as unknown,
    });

    feed.products.grafana = '{"id":"grafana","v":3}';
    feed.publish('2026-09-28T02:00:00Z');
    feed.forge();
    await expect(syncFeed(o)).rejects.toThrow(/signature/);
    expect(await readFile(path.join(o.dir, 'v1/index.json'), 'utf8')).toBe(before);
  });
});
