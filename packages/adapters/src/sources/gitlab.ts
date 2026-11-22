// GitLab releases or tags (REST API v4, gitlab.com or a self-managed instance). Public projects answer without a
// token; release notes are Markdown. Both lists come newest first.
import type { ReleaseSource } from '@versiondrift/schema';
import type { AdapterContext, RawRelease } from '../types.ts';
import { reachedKnown, toIso, withVersionRegex, type SourceType } from './common.ts';

type GitlabSource = SourceType<ReleaseSource, 'gitlab'>;

const PER_PAGE = 100;
const MAX_PAGES = 10;

interface GlRelease {
  tag_name: string;
  name: string | null;
  description: string | null;
  released_at: string | null;
  created_at: string;
  upcoming_release?: boolean;
  _links?: { self?: string };
}

interface GlTag {
  name: string;
  created_at: string | null; // annotated tags only
  commit?: { created_at?: string };
}

export async function gitlabReleases(source: GitlabSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const host = source.host ?? 'gitlab.com';
  const web = `https://${host}/${source.project}`;
  const api = `https://${host}/api/v4/projects/${encodeURIComponent(source.project)}`;
  const out: RawRelease[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let size: number;
    let mapped: RawRelease[];
    if (source.useTags) {
      const list = await ctx.fetcher.json<GlTag[]>(
        `${api}/repository/tags?per_page=${PER_PAGE}&page=${page}`,
      );
      size = list.length;
      mapped = list.map((tag): RawRelease => {
        const date = toIso(tag.created_at ?? tag.commit?.created_at);
        return {
          version: tag.name,
          url: `${web}/-/tags/${encodeURIComponent(tag.name)}`,
          ...(date && { date }),
        };
      });
    } else {
      const list = await ctx.fetcher.json<GlRelease[]>(`${api}/releases?per_page=${PER_PAGE}&page=${page}`);
      size = list.length;
      mapped = list
        .filter((r) => !r.upcoming_release)
        .map((r): RawRelease => ({
          version: r.tag_name,
          date: toIso(r.released_at ?? r.created_at),
          url: r._links?.self ?? `${web}/-/releases/${encodeURIComponent(r.tag_name)}`,
          ...(r.name && { title: r.name }),
          ...(r.description && { notes: { format: 'markdown', body: r.description } }),
        }));
    }
    const batch = withVersionRegex(mapped, source.versionRegex);
    out.push(...batch);
    if (size < PER_PAGE || reachedKnown(batch, ctx.knownVersions, ctx.since)) break;
  }
  return out;
}
