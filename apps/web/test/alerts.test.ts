import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from '@versiondrift/core';
import type { FeedIndex, FeedProduct } from '@versiondrift/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'vd-alerts-'));
vi.mock('$env/dynamic/private', () => ({ env: { VD_MODE: 'selfhosted', VD_DATA_DIR: dataDir } }));

const { boardsInventory, runAlerts, wanted } = await import('../src/lib/server/alerts.ts');
const { selfHostedStorage } = await import('../src/lib/server/storage.ts');

// A one-product local feed mirror: Grafana 12.0.0 → 12.1.0, and an advisory fixed in 12.1.0.
const release = (version: string) => ({
  version,
  sortKey: parse('semver', version)!.sortKey,
  track: null,
  date: '2026-09-01T00:00:00Z',
  firstSeenAt: '2026-09-01T00:00:00Z',
  url: null,
  prerelease: false,
  items: [],
  summary: null,
});
const grafana: FeedProduct = {
  formatVersion: '1.2',
  id: 'grafana',
  name: 'Grafana',
  versionScheme: 'semver',
  tracks: [],
  defaultTrack: 'latest',
  sources: [],
  branches: [],
  releases: [release('12.1.0'), release('12.0.0')],
  advisories: [
    {
      id: 'CVE-2026-1',
      aliases: [],
      title: 'bad',
      cvss: { score: 9.8, vector: '', version: '3.1' },
      severity: 'critical',
      kev: false,
      published: null,
      affected: [{ introduced: '0', fixed: '12.1.0' }],
      source: 'ghsa',
      url: 'https://example.com',
    },
  ],
  collectedAt: '2026-09-26T00:00:00Z',
  lastSuccessAt: '2026-09-26T00:00:00Z',
  stale: false,
};
const index: FeedIndex = {
  formatVersion: '1.2',
  generatedAt: '2026-09-26T00:00:00Z',
  collectorVersion: 'test',
  products: {
    grafana: {
      name: 'Grafana',
      category: 'monitoring',
      latest: '12.1.0',
      latestDate: null,
      tracks: {},
      maxSeverityLast30d: null,
      hasSecuritySource: true,
      updatedAt: '2026-09-26T00:00:00Z',
      stale: false,
      sha256: '0'.repeat(64),
      url: 'products/grafana.json',
    },
  },
};
mkdirSync(path.join(dataDir, 'feed/v1/products'), { recursive: true });
writeFileSync(path.join(dataDir, 'feed/v1/index.json'), JSON.stringify(index));
writeFileSync(path.join(dataDir, 'feed/v1/products/grafana.json'), JSON.stringify(grafana));

function hook() {
  const bodies: { text: string }[] = [];
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string) as { text: string });
    return Promise.resolve(new Response('ok'));
  });
  return bodies;
}

describe('self-hosted notifications', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pass the first-run summary, then only subscribed changes', () => {
    expect(wanted({ type: 'summary', kinds: [], html: '' }, [])).toBe(true);
    expect(wanted({ type: 'digest', kinds: [], html: '' }, ['critical'])).toBe(false);
    expect(wanted({ type: 'change', kinds: ['eolSoon'], html: '' }, ['eol'])).toBe(true);
    expect(wanted({ type: 'change', kinds: ['update'], html: '' }, ['critical'])).toBe(false);
    expect(wanted({ type: 'change', kinds: ['invalid'], html: '' }, [])).toBe(true);
  });

  it('report each board instance once per change, per channel', async () => {
    const { store, channels } = selfHostedStorage();
    store.replaceItems(store.defaultBoard().id, [
      { p: 'grafana', ver: '12.0.0', label: 'mon-01' },
      { p: 'nginx' },
    ]);
    expect(boardsInventory()).toEqual({
      boards: { Main: { products: { grafana: [{ version: '12.0.0', label: 'mon-01' }] } } },
    });
    const { id } = channels.create({
      name: 'hook',
      kind: 'webhook',
      config: { url: 'https://hooks.lan/vd' },
      events: ['critical'],
      lang: 'en',
      digestDay: null,
    });

    let bodies = hook();
    await runAlerts(() => {}, new Date('2026-09-26T03:00:00Z'));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.text).toContain('watching 1 instance');
    expect(channels.get(id)?.lastSentAt).toBe('2026-09-26T03:00:00.000Z');

    bodies = hook();
    await runAlerts(() => {}, new Date('2026-09-27T03:00:00Z'));
    expect(bodies).toHaveLength(0);

    // The version goes back to an older release → nothing new; a failing endpoint keeps the state for a retry.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('down', { status: 503 })));
    store.replaceItems(store.defaultBoard().id, [{ p: 'grafana', ver: '12.0.0', label: 'mon-02' }]);
    await runAlerts(() => {}, new Date('2026-09-28T03:00:00Z'));
    expect(channels.get(id)?.lastError).toBe('webhook: HTTP 503 down');
    expect(channels.get(id)?.lastSentAt).toBe('2026-09-26T03:00:00.000Z');
  });
});
