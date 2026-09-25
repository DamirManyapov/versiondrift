// The published feed, verified: index.json against the minisign public key, each product file against the
// sha256 the signed index lists.
import { createFetcher, type Fetcher } from '@versiondrift/adapters';
import { DEFAULT_FEED_URL, FEED_PUBLIC_KEY, sha256, verifyFile } from '@versiondrift/feed';
import type { Feed } from '@versiondrift/alerts';
import { FeedIndex, FeedProduct } from '@versiondrift/schema';

export { DEFAULT_FEED_URL, FEED_PUBLIC_KEY };

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
