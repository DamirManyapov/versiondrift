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
  fetchNotes,
  fetchReleases,
  recordingFetch,
  type AdapterContext,
  type FetchFn,
} from '../src/index.ts';

const MAX_ITEMS = 10;
const FIXTURES = path.join(import.meta.dirname, 'fixtures');

/** APT Packages indexes and debian/changelogs are megabytes: keep a few stanzas / entries. */
function trimText(url: string, text: string): string | undefined {
  if (url.endsWith('/Packages')) {
    const stanzas = text.split(/\n\s*\n/);
    const wanted = stanzas.filter((s) => /^Package: proxmox-backup-server$/m.test(s)).slice(-MAX_ITEMS);
    return [...stanzas.slice(0, 3), ...wanted].join('\n\n') + '\n';
  }
  if (url.includes('debian/changelog')) {
    const entries = text.split(/(?<=\n -- [^\n]+\n)/);
    return entries.slice(0, MAX_ITEMS).join('');
  }
  return undefined;
}

function trimmed(inner: FetchFn): FetchFn {
  return async (url, init) => {
    const response = await inner(url, init);
    if (!(response.headers.get('content-type') ?? '').includes('json')) {
      const text = await response.text();
      return new Response(trimText(String(url), text) ?? text, response);
    }
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
  notes?: { source: Extract<ReleaseSource, { type: 'notes' }>; versions: string[] };
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
  { name: 'gitea', release: { type: 'gitea', host: 'codeberg.org', repo: 'forgejo/forgejo' } },
  { name: 'endoflife', lifecycle: { type: 'endoflife', product: 'grafana' } },
  {
    name: 'debian',
    release: {
      type: 'apt',
      url: 'http://download.proxmox.com/debian/pbs/dists/trixie/pbs-no-subscription/binary-amd64/Packages',
      package: 'proxmox-backup-server',
      versionRegex: '^(\\d+\\.\\d+\\.\\d+)-\\d+$',
    },
  },
  {
    name: 'debian',
    release: {
      type: 'debian-changelog',
      url: 'https://git.proxmox.com/?p=proxmox-backup.git;a=blob_plain;f=debian/changelog;hb=HEAD',
      versionRegex: '^(\\d+\\.\\d+\\.\\d+)-\\d+$',
    },
  },
  {
    name: 'pointer',
    release: {
      type: 'pointer',
      url: 'https://upgrade.mikrotik.com/routeros/NEWESTa7.long-term',
      epoch: true,
    },
  },
  {
    name: 'pointer',
    notes: {
      source: { type: 'notes', url: 'https://upgrade.mikrotik.com/routeros/{version}/CHANGELOG' },
      versions: ['7.24', '7.23.7', '7.0.99'],
    },
  },
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
  const result = c.notes
    ? await Promise.all(c.notes.versions.map((v) => fetchNotes(c.notes!.source, v, ctx)))
    : c.kev
      ? [...(await fetchKev(fetcher))]
      : c.security
        ? await fetchAdvisories(c.security, ctx)
        : c.release
          ? await fetchReleases(c.release, ctx)
          : await fetchLifecycle(c.lifecycle!, ctx);
  const label = JSON.stringify(c.release ?? c.notes ?? c.lifecycle ?? c.security ?? 'kev').slice(0, 70);
  console.log(`${c.name}: ${label}… → ${result.length} items`);
}
