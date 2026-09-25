export * from './types.ts';
export {
  createFetcher,
  HttpError,
  USER_AGENT,
  type FetchFn,
  type Fetcher,
  type FetchResult,
  type RequestOptions,
} from './http/fetcher.ts';
export { FileHttpCache, MemoryHttpCache, type CacheEntry, type HttpCache } from './http/cache.ts';
export { fixtureFetch, recordingFetch } from './http/fixtures.ts';
export { fetchLifecycle, fetchReleases } from './sources/index.ts';
export { extractVersion, parseDate } from './sources/common.ts';
export { parseFeed } from './sources/feed.ts';
export { parseHtmlReleases } from './sources/html.ts';
export { changelogSections } from './sources/github.ts';
export { fetchAdvisories } from './advisories/index.ts';
export { fetchKev, KEV_URL } from './advisories/kev.ts';
export { parseRangeExpression, severityFromScore, type RawAdvisory } from './advisories/types.ts';
export { rangesFromConfigurations } from './advisories/nvd.ts';
