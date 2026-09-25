import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateSigningKey, parseSecret, sha256, signFile } from '@versiondrift/collector';
import { createFetcher, type FetchFn } from '@versiondrift/adapters';
import { parse } from '@versiondrift/core';
import type { Advisory, FeedProduct, Inventory, Release } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  FEED_PUBLIC_KEY,
  loadFeed,
  runNotify,
  splitMessage,
  telegram,
  type Feed,
  type NotifyState,
} from '../src/index.ts';

const rel = (version: string, date = '2026-09-01T00:00:00Z', extra: Partial<Release> = {}): Release => ({
  version,
  sortKey: parse('semver', version)!.sortKey,
  track: null,
  date,
  firstSeenAt: date,
  url: `https://example.test/${version}`,
  prerelease: false,
  items: [{ type: 'fix', text: 'x', classifiedBy: 'section' }],
  summary: null,
  ...extra,
});

function product(versions: string[], extra: Partial<FeedProduct> = {}): FeedProduct {
  return {
    formatVersion: '1.1',
    id: 'grafana',
    name: 'Grafana',
    versionScheme: 'semver',
    tracks: [],
    defaultTrack: 'latest',
    sources: [],
    branches: [],
    releases: versions.map((v) => rel(v)),
    advisories: [],
    collectedAt: '2026-09-25T02:00:00Z',
    lastSuccessAt: '2026-09-25T02:00:00Z',
    stale: false,
    ...extra,
  };
}

const feedOf = (p: FeedProduct): Feed => ({
  index: { formatVersion: '1.1', generatedAt: '', collectorVersion: '', products: {} },
  product: (id) => Promise.resolve(id === p.id ? p : undefined),
});
const inventory: Inventory = {
  boards: { prod: { products: { grafana: [{ version: '13.2.1', host: 'mon-01' }] } } },
};
const MON = new Date('2026-09-28T06:00:00Z');
const TUE = new Date('2026-09-29T06:00:00Z');
const opts = (now = TUE) => ({ lang: 'en' as const, now, digestDay: 1 });

async function sequence(steps: FeedProduct[], nows: Date[] = steps.map(() => TUE)) {
  let state: NotifyState = EMPTY_STATE;
  const sent: string[][] = [];
  for (const [i, p] of steps.entries()) {
    const result = await runNotify(inventory, feedOf(p), state, opts(nows[i]));
    sent.push(result.messages);
    state = result.state;
  }
  return sent;
}

describe('runNotify', () => {
  it('sends one summary on the first run, then only changes', async () => {
    const [first, second] = await sequence([product(['13.2.2', '13.2.1']), product(['13.2.2', '13.2.1'])]);
    expect(first).toHaveLength(1);
    expect(first?.[0]).toContain('now watching 1 instance');
    expect(first?.[0]).toContain('<b>Grafana</b> 13.2.1 → 13.2.2 · mon-01');
    expect(second).toEqual([]);
  });

  it('announces a new release when you are behind or were up to date', async () => {
    const sent = await sequence([
      product(['13.2.1']),
      product(['13.2.2', '13.2.1']),
      product(['13.2.3', '13.2.2', '13.2.1']),
    ]);
    expect(sent[1]).toHaveLength(1);
    expect(sent[1]![0]).toContain('Update available: 1 newer release (1 fixes)');
    expect(sent[1]![0]).toContain('<a href="https://example.test/13.2.2">release notes</a>');
    expect(sent[2]![0]).toContain('13.2.1 → 13.2.3');
  });

  it('alerts once per new affecting advisory', async () => {
    const adv = (id: string): Advisory => ({
      id,
      aliases: [],
      title: '',
      cvss: { score: 9.1, vector: '', version: '3.1' },
      severity: 'critical',
      kev: false,
      published: null,
      affected: [{ introduced: '13.0.0', fixed: '13.2.2' }],
      source: 'ghsa',
      url: '',
    });
    const base = ['13.2.2', '13.2.1'];
    const sent = await sequence([
      product(base),
      product(base, { advisories: [adv('CVE-2026-1')] }),
      product(base, { advisories: [adv('CVE-2026-1')] }),
      product(base, { advisories: [adv('CVE-2026-1'), adv('CVE-2026-2')] }),
    ]);
    expect(sent[1]![0]).toContain('Security issue affects your version: CVE-2026-1 (CVSS 9.1)');
    expect(sent[2]).toEqual([]);
    expect(sent[3]![0]).toContain('CVE-2026-2');
  });

  it('warns once when the branch nears end of life', async () => {
    const branch = {
      id: '13.2',
      codename: null,
      releaseDate: null,
      eol: false,
      eolDate: '2026-11-01',
      lts: false,
      latest: null,
    };
    const sent = await sequence([
      product(['13.2.1']),
      product(['13.2.1'], { branches: [branch] }),
      product(['13.2.1'], { branches: [branch] }),
    ]);
    expect(sent[1]![0]).toContain('reaches end of life on 2026-11-01');
    expect(sent[2]).toEqual([]);
  });

  it('sends the weekly digest on its day, once, with what shipped', async () => {
    const recent = product(['13.2.2', '13.2.1'], {
      releases: [rel('13.2.2', '2026-09-26T00:00:00Z'), rel('13.2.1')],
    });
    const sent = await sequence([recent, recent, recent], [TUE, MON, new Date('2026-09-28T18:00:00Z')]);
    expect(sent[1]).toHaveLength(1);
    expect(sent[1]![0]).toContain('📋 <b>Weekly summary</b>');
    expect(sent[1]![0]).toContain('Released this week:\n• <b>Grafana</b> 13.2.2');
    expect(sent[2]).toEqual([]);
  });

  it('writes Russian when asked', async () => {
    const result = await runNotify(inventory, feedOf(product(['13.2.2', '13.2.1'])), EMPTY_STATE, {
      ...opts(),
      lang: 'ru',
    });
    expect(result.messages[0]).toContain('VersionDrift следит за вашим стеком: 1 экз.');
  });
});

describe('loadFeed', () => {
  const { secret, publicKey } = generateSigningKey();
  const key = parseSecret(secret);
  const productText = JSON.stringify(product(['13.2.2']));
  const index = JSON.stringify({
    formatVersion: '1.1',
    generatedAt: '2026-09-26T02:00:00Z',
    collectorVersion: '0.1.0',
    products: {
      grafana: {
        name: 'Grafana',
        category: 'monitoring',
        latest: '13.2.2',
        latestDate: null,
        tracks: {},
        maxSeverityLast30d: null,
        hasSecuritySource: false,
        updatedAt: '2026-09-26T02:00:00Z',
        stale: false,
        sha256: sha256(productText),
        url: 'products/grafana.json?v=1',
      },
    },
  });
  const serve =
    (files: Record<string, string>): FetchFn =>
    (url) => {
      const body = files[new URL(url).pathname.replace('/v1/', '')];
      return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : new Response(body));
    };
  const fetcher = (files: Record<string, string>) =>
    createFetcher({ fetch: serve(files), sleep: () => Promise.resolve(), retries: 0 });

  it('verifies the index signature and each product hash', async () => {
    const files = {
      'index.json': index,
      'index.json.minisig': signFile(index, key, 'x'),
      'products/grafana.json': productText,
    };
    const feed = await loadFeed('https://feed.test/', { fetcher: fetcher(files), publicKey });
    expect((await feed.product('grafana'))?.releases[0]?.version).toBe('13.2.2');
    const tampered = await loadFeed('https://feed.test/', {
      fetcher: fetcher({ ...files, 'products/grafana.json': productText.replace('13.2.2', '13.2.9') }),
      publicKey,
    });
    await expect(tampered.product('grafana')).rejects.toThrow(/does not match the signed index/);
  });

  it('rejects an index signed by another key', async () => {
    const files = { 'index.json': index, 'index.json.minisig': signFile(index, key, 'x') };
    await expect(
      loadFeed('https://feed.test/', { fetcher: fetcher(files), publicKey: generateSigningKey().publicKey }),
    ).rejects.toThrow(/different key/);
  });

  it('ships the same public key as keys/feed.pub', () => {
    const file = readFileSync(path.resolve(import.meta.dirname, '../../../keys/feed.pub'), 'utf8');
    expect(file.trim().split('\n').pop()).toBe(FEED_PUBLIC_KEY);
  });
});

describe('telegram', () => {
  it('splits long messages on line boundaries', () => {
    const parts = splitMessage(
      Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n'),
    );
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(4000);
  });

  it('posts HTML messages and reports API errors', async () => {
    const calls: unknown[] = [];
    const ok = ((url: string, init: RequestInit) => {
      calls.push([url, JSON.parse(init.body as string)]);
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;
    await telegram('TOKEN', '42', ok).send('<b>hi</b>');
    expect(calls).toEqual([
      [
        'https://api.telegram.org/botTOKEN/sendMessage',
        { chat_id: '42', text: '<b>hi</b>', parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
      ],
    ]);
    const bad = (() =>
      Promise.resolve(
        Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 }),
      )) as unknown as typeof fetch;
    await expect(telegram('T', '1', bad).send('x')).rejects.toThrow(/chat not found/);
  });
});
