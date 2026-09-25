import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFetcher, fixtureFetch, type FetchFn } from '@versiondrift/adapters';
import { FeedIndex, FeedProduct, Health } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { isoWeek, runCollector, type RunOptions } from '../src/index.ts';

const ADAPTER_FIXTURES = path.resolve(import.meta.dirname, '../../../packages/adapters/test/fixtures');

/** Serves any fixture recorded for the adapter tests; hosts in `down` fail like a network outage. */
function fixtures(down: string[] = []): FetchFn {
  const dirs = ['github', 'rss', 'html', 'dockerhub', 'endoflife'].map((d) =>
    fixtureFetch(path.join(ADAPTER_FIXTURES, d)),
  );
  return async (url, init) => {
    if (down.includes(new URL(url).host)) throw new TypeError('fetch failed');
    for (const tryDir of dirs) {
      try {
        return await tryDir(url, init);
      } catch {
        // next directory
      }
    }
    throw new TypeError(`no fixture for ${url}`);
  };
}

const MODULES: Record<string, string> = {
  grafana: `id: grafana
name: Grafana
category: monitoring
versionScheme: semver
tagFilter: { include: '^v?\\d+\\.\\d+\\.\\d+$' }
tracks:
  - { id: "13", match: '^13\\.' }
  - { id: "12", match: '^12\\.' }
sources:
  releases: { type: github, repo: grafana/grafana }
  security: [{ type: ghsa, repo: grafana/grafana }]
  eol: { type: endoflife, product: grafana }
`,
  'poste-io': `id: poste-io
name: poste.io
category: mail
versionScheme: loose
sources:
  releases: { type: html, url: https://poste.io/changelog, select: { item: h2 }, versionRegex: '(\\d+\\.\\d+\\.\\d+)', dateFormat: YYYYMMDD }
  releasesExtra: [{ type: dockerhub, repo: analogic/poste.io, tagRegex: '^\\d+\\.\\d+\\.\\d+$' }]
classify: { keywords: { security: [roundcube] } }
`,
  zabbix: `id: zabbix
name: Zabbix
category: monitoring
versionScheme: semver
sources:
  releases: { type: github, repo: zabbix/zabbix, useTags: true }
`,
  broken: `id: broken
name: Broken
category: other
versionScheme: semver
sources:
  releases: { type: rss, url: https://broken.example/feed.xml }
`,
};

async function setup(ids = Object.keys(MODULES)) {
  const root = await mkdtemp(path.join(tmpdir(), 'vd-collector-'));
  const productsDir = path.join(root, 'products');
  await mkdir(productsDir);
  for (const id of ids) await writeFile(path.join(productsDir, `${id}.yaml`), MODULES[id]!);
  return { root, productsDir, out: path.join(root, 'feed') };
}

const quiet = { info() {}, warn() {} };
const DAY1 = new Date('2026-09-26T02:00:00Z');
const DAY2 = new Date('2026-09-27T02:00:00Z');

function options(base: { productsDir: string; out: string }, extra: Partial<RunOptions> = {}): RunOptions {
  return {
    productsDir: base.productsDir,
    out: base.out,
    previous: null,
    now: DAY1,
    log: quiet,
    fetcher: createFetcher({ fetch: fixtures(), sleep: () => Promise.resolve() }),
    ...extra,
  };
}

const readJson = async <T>(file: string, schema: { parse(v: unknown): T }) =>
  schema.parse(JSON.parse(await readFile(file, 'utf8')));

describe('runCollector', () => {
  it('builds a valid feed from scratch and reports broken modules without failing the run', async () => {
    const env = await setup();
    const result = await runCollector(options(env));
    expect(result.exitCode).toBe(0);

    const index = await readJson(path.join(env.out, 'v1/index.json'), FeedIndex);
    expect(Object.keys(index.products)).toEqual(['grafana', 'poste-io', 'zabbix']);
    expect(index.products.grafana).toMatchObject({
      latest: '13.2.2',
      tracks: { '13': '13.2.2', '12': '12.4.11' },
      hasSecuritySource: true,
    });

    const grafana = await readJson(path.join(env.out, 'v1/products/grafana.json'), FeedProduct);
    expect(grafana.releases.map((r) => r.version).slice(0, 3)).toEqual(['13.2.2', '13.2.1', '13.2.0']);
    expect(grafana.releases[0]?.items[0]).toMatchObject({ type: 'security', refs: ['CVE-2026-15815'] });
    expect(grafana.branches.find((b) => b.id === '13.2')).toMatchObject({ eol: false, latest: '13.2.2' });

    const poste = await readJson(path.join(env.out, 'v1/products/poste-io.json'), FeedProduct);
    expect(poste.releases.length).toBeGreaterThan(100);
    expect(poste.releases[0]).toMatchObject({ version: '2.5.17', date: '2026-09-18T00:00:00Z' });
    expect(poste.releases[0]?.items[0]).toMatchObject({ type: 'security', text: 'Roundcube 1.6.19' });

    const zabbix = await readJson(path.join(env.out, 'v1/products/zabbix.json'), FeedProduct);
    expect(zabbix.releases.some((r) => /rc/.test(r.version))).toBe(false);

    const health = await readJson(path.join(env.out, 'v1/health.json'), Health);
    expect(health.modules.broken).toMatchObject({
      status: 'failed',
      consecutiveFailures: 1,
      lastSuccessAt: null,
    });
    expect(health.ok).toBe(0.75);
    expect(await readdir(path.join(env.out, 'v1/week'))).toHaveLength(12);
  });

  it('is stable across runs: nothing new, items and firstSeenAt unchanged', async () => {
    const env = await setup();
    await runCollector(options(env));
    const first = await readFile(path.join(env.out, 'v1/products/grafana.json'), 'utf8');
    const second = await runCollector(
      options(env, { previous: env.out, now: DAY2, out: path.join(env.root, 'feed2') }),
    );
    const grafana = second.outcomes.find((o) => o.id === 'grafana')!.result;
    expect(grafana.ok && grafana.newReleases).toEqual([]);
    const next = JSON.parse(
      await readFile(path.join(env.root, 'feed2/v1/products/grafana.json'), 'utf8'),
    ) as { releases: unknown };
    expect(next.releases).toEqual((JSON.parse(first) as { releases: unknown }).releases);
    const health = await readJson(path.join(env.root, 'feed2/v1/health.json'), Health);
    expect(health.modules.broken?.consecutiveFailures).toBe(2);
  });

  it('recomputes items of current releases when the module changes', async () => {
    const env = await setup(['poste-io']);
    await runCollector(options(env));
    const before = await readJson(path.join(env.out, 'v1/products/poste-io.json'), FeedProduct);
    expect(before.releases[0]?.items[0]?.type).toBe('security');
    await writeFile(
      path.join(env.productsDir, 'poste-io.yaml'),
      MODULES['poste-io']!.replace('classify: { keywords: { security: [roundcube] } }\n', ''),
    );
    const out = path.join(env.root, 'feed2');
    const result = await runCollector(options(env, { previous: env.out, now: DAY2, out }));
    expect(result.outcomes[0]?.result.warnings).toContain(
      'module or classifier changed: items of current releases recomputed',
    );
    const after = await readJson(path.join(out, 'v1/products/poste-io.json'), FeedProduct);
    expect(after.releases[0]?.items[0]).toMatchObject({ text: 'Roundcube 1.6.19', type: 'other' });
    expect(after.releases[0]?.firstSeenAt).toBe(before.releases[0]?.firstSeenAt);
    expect(after.moduleHash).not.toBe(before.moduleHash);
  });

  it('keeps the previous data, marked stale, when a source fails', async () => {
    const env = await setup();
    await runCollector(options(env));
    const out = path.join(env.root, 'feed2');
    const result = await runCollector(
      options(env, {
        previous: env.out,
        now: DAY2,
        out,
        fetcher: createFetcher({
          fetch: fixtures(['api.github.com']),
          sleep: () => Promise.resolve(),
          retries: 0,
        }),
      }),
    );
    expect(result.exitCode).toBe(0);
    const index = await readJson(path.join(out, 'v1/index.json'), FeedIndex);
    expect(index.products.grafana).toMatchObject({
      stale: true,
      latest: '13.2.2',
      updatedAt: '2026-09-26T02:00:00Z',
    });
    const health = await readJson(path.join(out, 'v1/health.json'), Health);
    expect(health.modules.grafana).toMatchObject({
      status: 'failed',
      lastSuccessAt: '2026-09-26T02:00:00Z',
      consecutiveFailures: 1,
    });
  });

  it('refuses to write a feed that lost most products', async () => {
    const env = await setup();
    await runCollector(options(env));
    const smaller = await setup(['poste-io']);
    const result = await runCollector(options(smaller, { previous: env.out }));
    expect(result.exitCode).toBe(2);
    expect(result.problems[0]).toMatch(/index shrinks from 3 to 1/);
    await expect(readdir(smaller.out)).rejects.toThrow();
  });

  it('--only collects a subset and carries the other products over', async () => {
    const env = await setup();
    await runCollector(options(env));
    const out = path.join(env.root, 'feed2');
    const result = await runCollector(options(env, { previous: env.out, only: ['zabbix'], out, now: DAY2 }));
    expect(result.outcomes.map((o) => o.id)).toEqual(['zabbix']);
    const index = await readJson(path.join(out, 'v1/index.json'), FeedIndex);
    expect(Object.keys(index.products)).toEqual(['grafana', 'poste-io', 'zabbix']);
    expect(await readdir(path.join(out, 'v1/products'))).toEqual(['zabbix.json']);
    await expect(readdir(path.join(out, 'v1/week'))).rejects.toThrow();
  });
});

describe('isoWeek', () => {
  it.each([
    ['2026-01-01', 2026, 1],
    ['2026-09-26', 2026, 39],
    ['2027-01-01', 2026, 53],
    ['2024-12-30', 2025, 1],
  ])('%s → %i-W%i', (date, year, week) => {
    expect(isoWeek(new Date(`${date}T12:00:00Z`))).toMatchObject({ year, week });
  });
});
