import type { EolSource, Module, ReleaseSource, SecuritySource } from '@versiondrift/schema';

/** Human-facing link for a source (docs/03: "sources": [{ type, url }]). */
function linkFor(source: ReleaseSource | SecuritySource | EolSource): string | undefined {
  switch (source.type) {
    case 'github':
      return source.useTags
        ? `https://github.com/${source.repo}/tags`
        : `https://github.com/${source.repo}/releases`;
    case 'gitlab':
      return `https://${source.host ?? 'gitlab.com'}/${source.project}/-/releases`;
    case 'gitea':
      return `https://${source.host}/${source.repo}/releases`;
    case 'rss':
    case 'html':
      return source.url;
    case 'dockerhub':
      return source.repo.includes('/')
        ? `https://hub.docker.com/r/${source.repo}/tags`
        : `https://hub.docker.com/_/${source.repo}/tags`;
    case 'endoflife':
      return `https://endoflife.date/${source.product}`;
    case 'osv':
      return `https://osv.dev/list?ecosystem=${encodeURIComponent(source.ecosystem)}&q=${encodeURIComponent(source.package)}`;
    case 'ghsa':
      return source.repo
        ? `https://github.com/${source.repo}/security/advisories`
        : `https://github.com/advisories?query=${encodeURIComponent(source.package ?? '')}`;
    case 'nvd':
      return `https://nvd.nist.gov/products/cpe/search/results?namingFormat=2.3&keyword=${encodeURIComponent(source.cpe)}`;
    case 'debian':
      return 'https://security-tracker.debian.org/tracker/';
    case 'manual':
      return undefined;
  }
}

export function sourceLinks(module: Module): { type: string; url: string }[] {
  const all = [
    module.sources.releases,
    ...(module.sources.releasesExtra ?? []),
    ...(module.sources.security ?? []),
    ...(module.sources.eol ? [module.sources.eol] : []),
  ];
  const seen = new Set<string>();
  return all.flatMap((source) => {
    const url = linkFor(source);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ type: source.type, url }];
  });
}
