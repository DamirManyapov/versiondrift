import { feedBaseUrl } from '$lib/config';
import { FeedClient } from '$lib/feed/client';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, data }) => {
  const client = new FeedClient(feedBaseUrl(), fetch);
  const [health, index] = await Promise.all([client.health(), client.index()]);
  return { ...data, health, index };
};
