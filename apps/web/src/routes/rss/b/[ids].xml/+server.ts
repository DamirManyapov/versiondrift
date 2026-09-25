import { error } from '@sveltejs/kit';
import { feedBaseUrl } from '$lib/config';
import { FeedClient } from '$lib/feed/client';
import { recentDigests } from '$lib/feed/load';
import { translator } from '$lib/i18n';
import { parseIds, releaseItems, RSS_HEADERS, rssXml } from '$lib/seo/rss';
import type { RequestHandler } from './$types';

// A board's feed: /rss/b/grafana,nginx,debian.xml — product ids only, so no versions ever reach the server.
export const GET: RequestHandler = async ({ params, fetch, url, locals }) => {
  const ids = parseIds(params.ids);
  if (ids.length === 0) error(404, 'No products in the feed URL');
  const client = new FeedClient(feedBaseUrl(), fetch);
  const [index, digests] = await Promise.all([client.index(), recentDigests(client)]);
  const known = ids.filter((id) => index.products[id]);
  if (known.length === 0) error(404, 'None of these products are in the catalog');
  const t = translator(locals.locale);
  const xml = rssXml(
    {
      title: t('rssBoardTitle'),
      link: `${url.origin}/`,
      description: t('rssBoardDescription', {
        products: known.map((id) => index.products[id]?.name ?? id).join(', '),
      }),
      self: url.href,
      language: locals.locale,
    },
    releaseItems(digests, index, url.origin, new Set(known)),
  );
  return new Response(xml, { headers: RSS_HEADERS });
};
