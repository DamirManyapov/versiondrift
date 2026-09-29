// Reads the public feed (docs/03-feed-format.md) from the browser, Workers or Node: conditional requests with
// ETags, an in-memory cache, and a sha256 check of every product file against the index.
import { Catalog, FeedIndex, FeedProduct, Health, Versions, WeekDigest } from '@versiondrift/schema';
import { sha256Hex } from './sha256.ts';

export class FeedError extends Error {
  override name = 'FeedError';
}

interface Cached {
  etag: string | null;
  body: string;
}

export class FeedClient {
  readonly root: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache = new Map<string, Cached>();
  private indexPromise: Promise<FeedIndex> | undefined;

  /** `baseUrl` is the directory that contains v1/: https://feed.versiondrift.dev/ or a path like /feed/. */
  constructor(baseUrl: string, fetchFn: typeof fetch = (input, init) => fetch(input, init)) {
    this.root = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}v1/`;
    this.fetchFn = fetchFn;
  }

  private async text(path: string, reload = false): Promise<string> {
    const url = this.root + path;
    const cached = reload ? undefined : this.cache.get(url);
    const response = await this.fetchFn(url, {
      headers: cached?.etag ? { 'if-none-match': cached.etag } : {},
      ...(reload && { cache: 'reload' as RequestCache }),
    });
    if (response.status === 304 && cached) return cached.body;
    if (!response.ok) throw new FeedError(`${path}: HTTP ${response.status}`);
    const body = await response.text();
    this.cache.set(url, { etag: response.headers.get('etag'), body });
    return body;
  }

  /** The index is loaded once per client; `refresh()` forgets it. */
  index(): Promise<FeedIndex> {
    this.indexPromise ??= this.text('index.json').then((t) => FeedIndex.parse(JSON.parse(t)));
    this.indexPromise.catch(() => (this.indexPromise = undefined));
    return this.indexPromise;
  }

  refresh(): void {
    this.indexPromise = undefined;
  }

  async product(id: string): Promise<FeedProduct> {
    const entry = (await this.index()).products[id];
    if (!entry) throw new FeedError(`unknown product "${id}"`);
    let text = await this.text(entry.url);
    if ((await sha256Hex(text)) !== entry.sha256) {
      // A cache may still hold the previous file; ask once more, bypassing it.
      text = await this.text(entry.url, true);
      if ((await sha256Hex(text)) !== entry.sha256)
        throw new FeedError(`${id}: product file does not match the index`);
    }
    return FeedProduct.parse(JSON.parse(text));
  }

  async catalog(): Promise<Catalog> {
    return Catalog.parse(JSON.parse(await this.text('catalog.json')));
  }

  async health(): Promise<Health> {
    return Health.parse(JSON.parse(await this.text('health.json')));
  }

  async week(id: string): Promise<WeekDigest | undefined> {
    return this.optional(`week/${id}.json`, WeekDigest);
  }

  /** versions.json (feed 1.2+); undefined for older feeds. */
  async versions(): Promise<Versions | undefined> {
    return this.optional('versions.json', Versions);
  }

  private async optional<T>(path: string, schema: { parse(data: unknown): T }): Promise<T | undefined> {
    try {
      return schema.parse(JSON.parse(await this.text(path)));
    } catch (error) {
      if (error instanceof FeedError && /HTTP 404/.test(error.message)) return undefined;
      throw error;
    }
  }
}
