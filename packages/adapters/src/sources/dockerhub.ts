// Docker Hub tags: versions and push dates only (no notes); usually an extra source next to one with notes.
import type { ReleaseSource } from '@versiondrift/schema';
import type { AdapterContext, RawRelease } from '../types.ts';
import { reachedKnown, toIso, withVersionRegex, type SourceType } from './common.ts';

type DockerhubSource = SourceType<ReleaseSource, 'dockerhub'>;

interface TagsPage {
  next: string | null;
  results: { name: string; last_updated?: string | null; tag_last_pushed?: string | null }[];
}

const MAX_PAGES = 10;

export async function dockerhubReleases(source: DockerhubSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const repo = source.repo.includes('/') ? source.repo : `library/${source.repo}`;
  const page = repo.startsWith('library/')
    ? `https://hub.docker.com/_/${repo.slice(8)}`
    : `https://hub.docker.com/r/${repo}`;
  const filter = source.tagRegex ? new RegExp(source.tagRegex) : undefined;
  const out: RawRelease[] = [];
  let url: string | null =
    `https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&ordering=last_updated`;
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const data: TagsPage = await ctx.fetcher.json<TagsPage>(url);
    const tagged = data.results
      .filter((tag) => !filter || filter.test(tag.name))
      .map((tag): RawRelease => {
        const date = toIso(tag.tag_last_pushed ?? tag.last_updated);
        return {
          version: tag.name,
          url: `${page}/tags?name=${encodeURIComponent(tag.name)}`,
          ...(date && { date }),
        };
      });
    const batch = withVersionRegex(tagged, source.versionRegex);
    out.push(...batch);
    if (reachedKnown(batch, ctx.knownVersions, ctx.since)) break;
    url = data.next;
  }
  return out;
}
