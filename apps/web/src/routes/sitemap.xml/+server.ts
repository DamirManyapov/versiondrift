import { feedBaseUrl } from '$lib/config';
import { FeedClient } from '$lib/feed/client';
import { sitemapUrls, sitemapXml } from '$lib/seo/sitemap';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch, url }) => {
  const client = new FeedClient(feedBaseUrl(), fetch);
  const [index, versions] = await Promise.all([client.index(), client.versions()]);
  return new Response(sitemapXml(sitemapUrls(index, versions, url.origin)), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
};
