// GitHub releases (REST) or tags (GraphQL, one query returns 100 tags with their dates).
// Notes come from the release body (Markdown) or, with notesFrom: changelogFile, from a changelog file.
import type { ReleaseSource } from '@versiondrift/schema';
import { SourceError, type AdapterContext, type RawRelease } from '../types.ts';
import { extractVersion, reachedKnown, toIso, withVersionRegex, type SourceType } from './common.ts';

type GithubSource = SourceType<ReleaseSource, 'github'>;

const API = 'https://api.github.com';
const PER_PAGE = 100;
const MAX_PAGES = 10;

interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  created_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

interface TagNode {
  name: string;
  target: { committedDate?: string; tagger?: { date?: string } | null; target?: { committedDate?: string } };
}

interface TagsResponse {
  data?: {
    repository: {
      refs: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: TagNode[] };
    } | null;
  };
  errors?: { message: string }[];
}

const TAGS_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/tags/", first: 100, after: $cursor, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { name target { ... on Commit { committedDate } ... on Tag { tagger { date } target { ... on Commit { committedDate } } } } }
    }
  }
}`;

async function releases(source: GithubSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const out: RawRelease[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await ctx.fetcher.json<GhRelease[]>(
      `${API}/repos/${source.repo}/releases?per_page=${PER_PAGE}&page=${page}`,
      {
        headers: { accept: 'application/vnd.github+json' },
      },
    );
    const batch = withVersionRegex(
      list
        .filter((r) => !r.draft)
        .map((r): RawRelease => ({
          version: r.tag_name,
          date: toIso(r.published_at ?? r.created_at),
          url: r.html_url,
          ...(r.name && { title: r.name }),
          ...(r.body && { notes: { format: 'markdown', body: r.body } }),
          prerelease: r.prerelease,
        })),
      source.versionRegex,
    );
    out.push(...batch);
    if (list.length < PER_PAGE || reachedKnown(batch, ctx.knownVersions, ctx.since)) break;
  }
  return out;
}

async function tags(source: GithubSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const [owner, name] = source.repo.split('/');
  const out: RawRelease[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response: TagsResponse = await ctx.fetcher.json<TagsResponse>(`${API}/graphql`, {
      method: 'POST',
      body: JSON.stringify({ query: TAGS_QUERY, variables: { owner, name, cursor } }),
    });
    if (response.errors?.length)
      throw new SourceError(`GitHub GraphQL: ${response.errors.map((e) => e.message).join('; ')}`);
    const refs = response.data?.repository?.refs;
    if (!refs) throw new SourceError(`repository ${source.repo} not found`);
    const tagged = refs.nodes.map((tag): RawRelease => {
      const date = toIso(
        tag.target.tagger?.date ?? tag.target.committedDate ?? tag.target.target?.committedDate,
      );
      return {
        version: tag.name,
        url: `https://github.com/${source.repo}/releases/tag/${encodeURIComponent(tag.name)}`,
        ...(date && { date }),
      };
    });
    const batch = withVersionRegex(tagged, source.versionRegex);
    out.push(...batch);
    if (!refs.pageInfo.hasNextPage || reachedKnown(batch, ctx.knownVersions, ctx.since)) break;
    cursor = refs.pageInfo.endCursor;
  }
  return out;
}

/** Splits a Markdown changelog into sections keyed by the version found in each heading. */
export function changelogSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: { version: string; level: number; lines: string[] } | undefined;
  const flush = () => {
    if (current && !sections.has(current.version))
      sections.set(current.version, current.lines.join('\n').trim());
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const version = extractVersion(heading[2]!);
      if (version !== undefined) {
        flush();
        current = { version: version.replace(/^v/, ''), level, lines: [] };
        continue;
      }
      if (current && level <= current.level) {
        flush();
        current = undefined;
        continue;
      }
    }
    current?.lines.push(line);
  }
  flush();
  return sections;
}

export async function githubReleases(source: GithubSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const list = source.useTags ? await tags(source, ctx) : await releases(source, ctx);
  if (source.notesFrom !== 'changelogFile') return list;
  const file = source.changelogPath ?? 'CHANGELOG.md';
  const { body } = await ctx.fetcher.text(`${API}/repos/${source.repo}/contents/${file}`, {
    headers: { accept: 'application/vnd.github.raw' },
  });
  const sections = changelogSections(body);
  return list.map((r) => {
    const notes = sections.get(r.version.replace(/^v/, ''));
    return notes ? { ...r, notes: { format: 'markdown', body: notes } } : r;
  });
}
