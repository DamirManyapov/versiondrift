// The published feed, verified: index.json against the minisign public key, each product file against the
// sha256 the signed index lists.
import { createFetcher, type Fetcher } from '@versiondrift/adapters';
import { sha256, verifyFile } from '@versiondrift/collector';
import { FeedIndex, FeedProduct } from '@versiondrift/schema';

/** keys/feed.pub — the key the official collector signs with. */
export const FEED_PUBLIC_KEY = 'RWS5QKz6JGR7xISHHllazU/WZfqYkET1YLLxuKPMlK8s7N13793Wd/2N';
export const DEFAULT_FEED_URL = 'https://feed.versiondrift.dev/';

export interface Feed {
  index: FeedIndex;
  product(id: string): Promise<FeedProduct | undefined>;
}

export async function loadFeed(
  base: string,
  options: { fetcher?: Fetcher; publicKey?: string | null } = {},
): Promise<Feed> {
  const fetcher = options.fetcher ?? createFetcher();
  const root = new URL('v1/', base.endsWith('/') ? base : `${base}/`);
  const indexText = (await fetcher.text(new URL('index.json', root).toString())).body;
  const publicKey = options.publicKey === undefined ? FEED_PUBLIC_KEY : options.publicKey;
  if (publicKey !== null) {
    const signature = (await fetcher.text(new URL('index.json.minisig', root).toString())).body;
    verifyFile(indexText, signature, publicKey);
  }
  const index = FeedIndex.parse(JSON.parse(indexText));
  return {
    index,
    async product(id) {
      const entry = index.products[id];
      if (!entry) return undefined;
      const text = (await fetcher.text(new URL(entry.url, root).toString())).body;
      if (sha256(text) !== entry.sha256)
        throw new Error(`${id}: product file does not match the signed index`);
      return FeedProduct.parse(JSON.parse(text));
    },
  };
}
