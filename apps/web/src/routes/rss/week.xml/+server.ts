import { feedBaseUrl } from '$lib/config';
import { FeedClient } from '$lib/feed/client';
import { recentDigests } from '$lib/feed/load';
import { translator } from '$lib/i18n';
import { RSS_HEADERS, rssXml, weekItems } from '$lib/seo/rss';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch, url, locals }) => {
  const client = new FeedClient(feedBaseUrl(), fetch);
  const [index, digests] = await Promise.all([client.index(), recentDigests(client)]);
  const t = translator(locals.locale);
  const xml = rssXml(
    {
      title: t('rssWeekTitle'),
      link: `${url.origin}/week`,
      description: t('rssWeekDescription'),
      self: url.href,
      language: locals.locale,
    },
    weekItems(digests, index, url.origin, t),
  );
  return new Response(xml, { headers: RSS_HEADERS });
};
