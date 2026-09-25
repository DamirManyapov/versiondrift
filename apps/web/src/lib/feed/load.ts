// Shared by the server-rendered product, compare and version pages: index entry + product file, or 404/502.
import { error } from '@sveltejs/kit';
import { feedBaseUrl } from '$lib/config';
import { FeedClient, FeedError } from './client.ts';

export async function loadProduct(fetch: typeof globalThis.fetch, id: string) {
  const client = new FeedClient(feedBaseUrl(), fetch);
  const index = await client.index();
  const entry = index.products[id];
  if (!entry) error(404, `Unknown product "${id}"`);
  try {
    return { entry, product: await client.product(id), generatedAt: index.generatedAt };
  } catch (e) {
    if (e instanceof FeedError) error(502, e.message);
    throw e;
  }
}

/** Search engines and the edge may keep rendered pages for a while; the feed changes once a day. */
export const PAGE_CACHE = { 'cache-control': 'public, max-age=600, stale-while-revalidate=86400' };
