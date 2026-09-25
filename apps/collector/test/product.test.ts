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
