import { error } from '@sveltejs/kit';
import { feedBaseUrl } from '$lib/config';
import { FeedClient, FeedError } from '$lib/feed/client';
import type { PageLoad } from './$types';

// Server-rendered for search engines; the same load runs in the browser on client-side navigation.
export const load: PageLoad = async ({ params, fetch }) => {
  const client = new FeedClient(feedBaseUrl(), fetch);
  const index = await client.index();
  const entry = index.products[params.id];
  if (!entry) error(404, `Unknown product "${params.id}"`);
  try {
    return { entry, product: await client.product(params.id), generatedAt: index.generatedAt };
  } catch (e) {
    if (e instanceof FeedError) error(502, e.message);
    throw e;
  }
};
