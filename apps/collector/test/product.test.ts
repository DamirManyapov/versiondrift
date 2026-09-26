import { createFetcher } from '@versiondrift/adapters';
import { Module } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { collectProduct } from '../src/index.ts';

const module = Module.parse({
  id: 'example',
  name: 'Example',
  category: 'other',
  versionScheme: 'semver',
  sources: {
    releases: { type: 'manual', file: 'products/example.releases.yaml' },
    security: [{ type: 'ghsa', repo: 'example/example' }],
  },
  maintainers: ['@someone'],
});

function context(advisory: Record<string, unknown>) {
  return {
    fetcher: createFetcher({
      fetch: () => Promise.resolve(Response.json([advisory])),
      sleep: () => Promise.resolve(),
    }),
    log: { info() {}, warn() {} },
    now: new Date('2026-09-26T00:00:00Z'),
    kev: new Set<string>(),
    readRepoFile: () => Promise.resolve('- { version: "1.0.0", date: "2026-09-01" }\n'),
  };
}

const advisory = {
  ghsa_id: 'GHSA-aaaa-bbbb-cccc',
  cve_id: 'CVE-2026-0001',
  summary: 'Something',
  severity: 'high',
  published_at: '2026-09-01T00:00:00Z',
  html_url: 'https://github.com/example/example/security/advisories/GHSA-aaaa-bbbb-cccc',
  vulnerabilities: [{ vulnerable_version_range: '< 1.0.1', patched_versions: '1.0.1' }],
};

describe('collectProduct', () => {
  it('publishes products that match the feed schema', async () => {
    const result = await collectProduct(module, undefined, context(advisory));
    expect(result.ok).toBe(true);
  });

  it('refuses a product the clients could not parse, keeping the previous one', async () => {
    const good = await collectProduct(module, undefined, context(advisory));
    if (!good.ok) throw new Error(good.error);
    const broken = { ...advisory, cvss: { score: 12, vector_string: 'CVSS:3.1/AV:N' } };
    const result = await collectProduct(module, good.product, context(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^invalid product data at advisories\.0\.cvss\.score/);
    expect(result.product).toMatchObject({ stale: true, advisories: good.product.advisories });
  });
});

describe('update channels', () => {
  const channelled = Module.parse({
    id: 'channelled',
    name: 'Channelled',
    category: 'network',
    versionScheme: 'loose',
    defaultTrack: 'stable',
    tracks: [
      { id: 'long-term', current: { url: 'https://upd.test/NEWEST.long-term' } },
      { id: 'stable', match: '^7\\.' },
    ],
    sources: {
      releases: [
        { type: 'manual', file: 'products/channelled.releases.yaml' },
        { type: 'pointer', url: 'https://upd.test/NEWEST.long-term', epoch: true },
      ],
      releasesExtra: [{ type: 'notes', url: 'https://upd.test/{version}/CHANGELOG' }],
    },
    maintainers: ['@someone'],
  });

  function server(longTerm: string | null) {
    const asked: string[] = [];
    const fetch = (url: string | URL) => {
      const u = String(url);
      asked.push(u);
      if (u === 'https://upd.test/NEWEST.long-term')
        return Promise.resolve(
          longTerm ? new Response(`${longTerm} 1789561155`) : new Response('down', { status: 503 }),
        );
      const notes = /\/([^/]+)\/CHANGELOG$/.exec(u)?.[1];
      if (notes)
        return Promise.resolve(
          new Response(`What's new in ${notes} (2026-09-16):\n\n*) ssh - fixed a crash;\n`),
        );
      return Promise.resolve(new Response('missing', { status: 404 }));
    };
    return {
      asked,
      ctx: {
        fetcher: createFetcher({ fetch, sleep: () => Promise.resolve() }),
        log: { info() {}, warn() {} },
        now: new Date('2026-09-26T00:00:00Z'),
        kev: new Set<string>(),
        readRepoFile: () =>
          Promise.resolve('- { version: "7.24.4", date: "2026-09-16" }\n- { version: "7.22.3" }\n'),
      },
    };
  }

  it('resolves a pointer track to its branch, merges sources and fetches notes for new releases', async () => {
    const { ctx } = server('7.23.7');
    const result = await collectProduct(channelled, undefined, ctx);
    if (!result.ok) throw new Error(result.error);
    const { product } = result;
    expect(product.tracks[0]).toEqual({ id: 'long-term', match: '^7\\.23(\\.|$)', current: '7.23.7' });
    expect(product.releases.map((r) => [r.version, r.track])).toEqual([
      ['7.24.4', 'stable'],
      ['7.23.7', 'long-term'],
      ['7.22.3', 'stable'],
    ]);
    // The pointer's Unix time dates the release it names.
    expect(product.releases.find((r) => r.version === '7.23.7')?.date).toBe('2026-09-16T12:19:15Z');
    expect(product.releases.every((r) => r.items[0]?.text === 'ssh - fixed a crash')).toBe(true);
  });

  it('keeps the previous branch when the channel file is unreachable, and fetches no notes it has', async () => {
    const first = await collectProduct(channelled, undefined, server('7.23.7').ctx);
    if (!first.ok) throw new Error(first.error);
    const again = server(null);
    const result = await collectProduct(channelled, first.product, again.ctx);
    if (!result.ok) throw new Error(result.error);
    expect(result.product.tracks[0]).toMatchObject({ match: '^7\\.23(\\.|$)', current: '7.23.7' });
    expect(result.warnings.some((w) => w.includes('kept the previous branch'))).toBe(true);
    expect(again.asked.filter((u) => u.endsWith('/CHANGELOG'))).toEqual([]);
  });
});
