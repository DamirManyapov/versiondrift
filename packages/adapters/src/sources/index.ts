import type { EolSource, ReleaseSource } from '@versiondrift/schema';
import { SourceError, type AdapterContext, type RawBranch, type RawRelease } from '../types.ts';
import { dockerhubReleases } from './dockerhub.ts';
import { rssReleases } from './feed.ts';
import { giteaReleases } from './gitea.ts';
import { githubReleases } from './github.ts';
import { htmlReleases } from './html.ts';
import { endoflifeBranches, endoflifeReleases, manualBranches } from './lifecycle.ts';
import { manualReleases } from './manual.ts';

export function fetchReleases(source: ReleaseSource, ctx: AdapterContext): Promise<RawRelease[]> {
  switch (source.type) {
    case 'github':
      return githubReleases(source, ctx);
    case 'rss':
      return rssReleases(source, ctx);
    case 'html':
      return htmlReleases(source, ctx);
    case 'dockerhub':
      return dockerhubReleases(source, ctx);
    case 'manual':
      return manualReleases(source, ctx);
    case 'endoflife':
      return endoflifeReleases(source, ctx);
    case 'gitea':
      return giteaReleases(source, ctx);
    case 'gitlab':
      return Promise.reject(new SourceError(`source type "${source.type}" is not implemented yet`));
  }
}

export function fetchLifecycle(source: EolSource, ctx: AdapterContext): Promise<RawBranch[]> {
  switch (source.type) {
    case 'endoflife':
      return endoflifeBranches(source, ctx);
    case 'manual':
      return manualBranches(source, ctx);
  }
}
