import type { EolSource, ReleaseSource } from '@versiondrift/schema';
import { SourceError, type AdapterContext, type RawBranch, type RawRelease } from '../types.ts';
import { changelogFileReleases } from './changelog.ts';
import { aptReleases, debianChangelogReleases } from './debian.ts';
import { dockerhubReleases } from './dockerhub.ts';
import { rssReleases } from './feed.ts';
import { giteaReleases } from './gitea.ts';
import { githubReleases } from './github.ts';
import { htmlReleases } from './html.ts';
import { endoflifeBranches, endoflifeReleases, manualBranches } from './lifecycle.ts';
import { manualReleases } from './manual.ts';
import { pointerReleases } from './pointer.ts';

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
    case 'pointer':
      return pointerReleases(source, ctx);
    case 'apt':
      return aptReleases(source, ctx);
    case 'debian-changelog':
      return debianChangelogReleases(source, ctx);
    case 'changelog':
      return changelogFileReleases(source, ctx);
    case 'notes':
      // Needs the versions to fetch: the collector calls fetchNotes for the releases it classifies.
      return Promise.reject(new SourceError('notes only enriches releases (releasesExtra)'));
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
