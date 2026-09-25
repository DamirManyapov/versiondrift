// Records the fixtures used by the adapter tests from the live sources:
//   GITHUB_TOKEN=$(gh auth token) pnpm -F @versiondrift/adapters record [fixture dirs…]
// Without arguments every fixture directory is re-recorded; with arguments only those (e.g. "nvd kev").
// Long JSON lists are cut to MAX_ITEMS before the adapter sees them, so tests replay exactly what was recorded.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { EolSource, ReleaseSource, SecuritySource } from '@versiondrift/schema';
import {
  createFetcher,
  fetchAdvisories,
  fetchKev,
  fetchLifecycle,
  fetchReleases,
  recordingFetch,
  type AdapterContext,
  type FetchFn,
} from '../src/index.ts';

const MAX_ITEMS = 10;
const FIXTURES = path.join(import.meta.dirname, 'fixtures');

function trimmed(inner: FetchFn): FetchFn {
  return async (url, init) => {
    const response = await inner(url, init);
    if (!(response.headers.get('content-type') ?? '').includes('json')) return response;
    const data: unknown = await response.json();
    const trim = (list: unknown[]) => list.slice(0, MAX_ITEMS);
    if (Array.isArray(data)) return Response.json(trim(data), response);
    const record = data as {
      results?: unknown[];
      vulnerabilities?: unknown[];
      totalResults?: number;
      data?: { repository?: { refs?: { nodes: unknown[] } } };
    };
    if (Array.isArray(record.results)) Object.assign(record, { results: trim(record.results), next: null });
    if (Array.isArray(record.vulnerabilities)) {
      record.vulnerabilities = trim(record.vulnerabilities);
      if (record.totalResults !== undefined) record.totalResults = record.vulnerabilities.length;
    }
    const refs = record.data?.repository?.refs;
    if (refs)
      Object.assign(refs, { nodes: trim(refs.nodes), pageInfo: { hasNextPage: false, endCursor: null } });
    return Response.json(record, response);
  };
}

type Case = {
  name: string;
  release?: ReleaseSource;
  lifecycle?: EolSource;
  security?: SecuritySource;
  kev?: true;
};

const cases: Case[] = [
  { name: 'github', release: { type: 'github', repo: 'grafana/grafana' } },
  { name: 'github', release: { type: 'github', repo: 'zabbix/zabbix', useTags: true } },
  {
    name: 'rss',
    release: {
      type: 'rss',
      url: 'https://www.debian.org/News/news',
      versionFrom: 'title',
      versionRegex: 'Debian (\\d+\\.\\d+) released|Updated Debian \\d+: (\\d+\\.\\d+) released',
    },
  },
  {
    name: 'rss',
    release: {
      type: 'rss',
      url: 'https://mikrotik.com/current.rss',
      versionFrom: 'title',
      versionRegex: 'RouterOS (\\d+\\.\\d+(?:\\.\\d+)?) \\[stable\\]',
    },
  },
  {
    name: 'rss',
    release: { type: 'rss', url: 'https://github.com/grafana/grafana/releases.atom', versionFrom: 'title' },
  },
  {
    name: 'html',
    release: {
      type: 'html',
      url: 'https://poste.io/changelog',
      select: { item: 'h2' },
      versionRegex: '(\\d+\\.\\d+\\.\\d+)',
      dateFormat: 'YYYYMMDD',
    },
  },
  {
    name: 'dockerhub',
    release: { type: 'dockerhub', repo: 'analogic/poste.io', tagRegex: '^\\d+\\.\\d+\\.\\d+$' },
  },
  { name: 'endoflife', lifecycle: { type: 'endoflife', product: 'grafana' } },
  { name: 'endoflife', lifecycle: { type: 'endoflife', product: 'debian' } },
  { name: 'ghsa', security: { type: 'ghsa', repo: 'grafana/grafana' } },
  { name: 'nvd', security: { type: 'nvd', cpe: 'cpe:2.3:a:grafana:grafana' } },
  { name: 'osv', security: { type: 'osv', ecosystem: 'npm', package: 'minimist' } },
  { name: 'kev', kev: true },
];

const only = process.argv.slice(2);
const selected = only.length > 0 ? cases.filter((c) => only.includes(c.name)) : cases;
for (const name of new Set(selected.map((c) => c.name)))
  await rm(path.join(FIXTURES, name), { recursive: true, force: true });

for (const c of selected) {
  const token = process.env.GITHUB_TOKEN;
  const fetcher = createFetcher({
    fetch: recordingFetch(
      trimmed((url, init) => fetch(url, init)),
      path.join(FIXTURES, c.name),
    ),
    ...(token && { auth: { 'api.github.com': { authorization: `Bearer ${token}` } } }),
  });
  const ctx: AdapterContext = { fetcher, log: console, knownVersions: new Set() };
  const result = c.kev
    ? [...(await fetchKev(fetcher))]
    : c.security
      ? await fetchAdvisories(c.security, ctx)
      : c.release
        ? await fetchReleases(c.release, ctx)
        : await fetchLifecycle(c.lifecycle!, ctx);
  const label = JSON.stringify(c.release ?? c.lifecycle ?? c.security ?? 'kev').slice(0, 70);
  console.log(`${c.name}: ${label}… → ${result.length} items`);
}
