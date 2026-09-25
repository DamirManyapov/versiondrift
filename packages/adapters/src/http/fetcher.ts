// The only way adapters touch the network (CLAUDE.md: adapters get an injected fetcher, tests replay fixtures).
// Adds the bot User-Agent, per-host pacing, retries with backoff, timeouts, per-host auth headers and
// conditional requests (ETag / Last-Modified) backed by an HttpCache.
import type { HttpCache } from './cache.ts';
import { HostLimiter } from './limiter.ts';

export const USER_AGENT = 'VersionDriftBot/1.0 (+https://versiondrift.dev/bot)';

/** The subset of global fetch the fetcher needs; tests and fixture replay swap it. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  /** True when the server answered 304 and the body came from the cache. */
  fromCache: boolean;
}

export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  readonly url: string;
  constructor(url: string, status: number, detail = '') {
    super(`HTTP ${status} for ${url}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.url = url;
  }
}

export interface FetcherOptions {
  fetch?: FetchFn;
  cache?: HttpCache;
  /** Extra headers per host, e.g. { 'api.github.com': { authorization: 'Bearer …' } }. Never logged. */
  auth?: Record<string, Record<string, string>>;
  /** Minimum ms between request starts to one host. Default 500, api.github.com 100. */
  intervals?: Record<string, number>;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface Fetcher {
  /** Any status is returned; network errors, 429 and 5xx are retried first. */
  request(url: string, options?: RequestOptions): Promise<FetchResult>;
  /** Like request, but throws HttpError unless the status is 2xx (or a 304 served from the cache). */
  text(url: string, options?: RequestOptions): Promise<FetchResult>;
  json<T>(url: string, options?: RequestOptions): Promise<T>;
}

const DEFAULT_INTERVALS: Record<string, number> = { 'api.github.com': 100 };
const KEPT_HEADERS = ['content-type', 'etag', 'last-modified', 'link', 'retry-after', 'date'];
const MAX_CACHED_BODY = 8 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 60_000;

function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (KEPT_HEADERS.includes(key) || key.startsWith('x-ratelimit-')) out[key] = value;
  });
  return out;
}

/** Milliseconds to wait before retrying, from Retry-After or GitHub's rate-limit headers; undefined if none. */
function serverDelay(headers: Headers, now: number): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - now);
  }
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - now);
  }
  return undefined;
}

export function createFetcher(options: FetcherOptions = {}): Fetcher {
  const fetchFn: FetchFn = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const intervals = { ...DEFAULT_INTERVALS, ...options.intervals };
  const limiter = new HostLimiter({ intervalFor: (host) => intervals[host] ?? 500, sleep, now });
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function once(url: string, init: RequestInit): Promise<Response> {
    const host = new URL(url).host;
    return limiter.run(host, () => fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }));
  }

  async function request(url: string, opts: RequestOptions = {}): Promise<FetchResult> {
    const method = opts.method ?? 'GET';
    const host = new URL(url).host;
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      ...options.auth?.[host],
      ...opts.headers,
    };
    const cacheKey = method === 'GET' ? `${url} ${headers.accept ?? ''}` : undefined;
    const cached = cacheKey && options.cache ? await options.cache.get(cacheKey) : undefined;
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await once(url, { method, headers, ...(opts.body !== undefined && { body: opts.body }) });
      } catch (error) {
        if (attempt >= retries) throw error;
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      if (retryable && attempt < retries) {
        const delay = serverDelay(response.headers, now()) ?? 1000 * 2 ** attempt;
        if (delay <= MAX_RETRY_AFTER_MS) {
          await response.body?.cancel();
          await sleep(delay);
          continue;
        }
      }

      if (response.status === 304 && cached) {
        await response.body?.cancel();
        return { url, status: cached.status, headers: cached.headers, body: cached.body, fromCache: true };
      }

      const body = await response.text();
      const result: FetchResult = {
        url,
        status: response.status,
        headers: pickHeaders(response.headers),
        body,
        fromCache: false,
      };
      const etag = response.headers.get('etag') ?? undefined;
      const lastModified = response.headers.get('last-modified') ?? undefined;
      if (
        cacheKey &&
        options.cache &&
        response.ok &&
        (etag || lastModified) &&
        body.length <= MAX_CACHED_BODY
      ) {
        await options.cache.set(cacheKey, {
          url,
          ...(etag && { etag }),
          ...(lastModified && { lastModified }),
          status: response.status,
          headers: result.headers,
          body,
          storedAt: new Date(now()).toISOString(),
        });
      }
      return result;
    }
  }

  async function text(url: string, opts?: RequestOptions): Promise<FetchResult> {
    const result = await request(url, opts);
    if (result.status < 200 || result.status >= 300)
      throw new HttpError(url, result.status, result.body.slice(0, 200));
    return result;
  }

  return {
    request,
    text,
    async json<T>(url: string, opts?: RequestOptions): Promise<T> {
      const result = await text(url, { ...opts, headers: { accept: 'application/json', ...opts?.headers } });
      return JSON.parse(result.body) as T;
    },
  };
}
