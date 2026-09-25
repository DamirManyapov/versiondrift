// Records the fixtures used by the adapter tests from the live sources:
//   GITHUB_TOKEN=$(gh auth token) pnpm -F @versiondrift/adapters record
// Long JSON lists are cut to MAX_ITEMS before the adapter sees them, so tests replay exactly what was recorded.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { EolSource, ReleaseSource } from '@versiondrift/schema';
import {
  createFetcher,
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
      data?: { repository?: { refs?: { nodes: unknown[] } } };
    };
    if (Array.isArray(record.results)) Object.assign(record, { results: trim(record.results), next: null });
    const refs = record.data?.repository?.refs;
    if (refs)
      Object.assign(refs, { nodes: trim(refs.nodes), pageInfo: { hasNextPage: false, endCursor: null } });
    return Response.json(record, response);
  };
}

type Case = { name: string; release?: ReleaseSource; lifecycle?: EolSource };

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
];

for (const name of new Set(cases.map((c) => c.name)))
  await rm(path.join(FIXTURES, name), { recursive: true, force: true });

for (const c of cases) {
  const token = process.env.GITHUB_TOKEN;
  const fetcher = createFetcher({
    fetch: recordingFetch(
      trimmed((url, init) => fetch(url, init)),
      path.join(FIXTURES, c.name),
    ),
    ...(token && { auth: { 'api.github.com': { authorization: `Bearer ${token}` } } }),
  });
  const ctx: AdapterContext = { fetcher, log: console, knownVersions: new Set() };
  const result = c.release ? await fetchReleases(c.release, ctx) : await fetchLifecycle(c.lifecycle!, ctx);
  console.log(
    `${c.name}: ${JSON.stringify(c.release ?? c.lifecycle).slice(0, 70)}… → ${result.length} items`,
  );
}
