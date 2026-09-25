// Gitea / Forgejo releases (REST API v1, the same on Codeberg and self-hosted instances). Notes are Markdown.
import type { ReleaseSource } from '@versiondrift/schema';
import type { AdapterContext, RawRelease } from '../types.ts';
import { reachedKnown, toIso, withVersionRegex, type SourceType } from './common.ts';

type GiteaSource = SourceType<ReleaseSource, 'gitea'>;

const LIMIT = 50; // the default maximum page size of Gitea instances
const MAX_PAGES = 20;

interface GiteaRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  created_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

export async function giteaReleases(source: GiteaSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const out: RawRelease[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await ctx.fetcher.json<GiteaRelease[]>(
      `https://${source.host}/api/v1/repos/${source.repo}/releases?limit=${LIMIT}&page=${page}`,
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
    if (list.length < LIMIT || reachedKnown(batch, ctx.knownVersions, ctx.since)) break;
  }
  return out;
}
