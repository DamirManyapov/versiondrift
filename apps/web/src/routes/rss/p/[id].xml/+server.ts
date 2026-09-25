import { loadProduct } from '$lib/feed/load';
import { translator } from '$lib/i18n';
import { productItems, RSS_HEADERS, rssXml } from '$lib/seo/rss';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, fetch, url, locals }) => {
  const { product } = await loadProduct(fetch, params.id);
  const t = translator(locals.locale);
  const xml = rssXml(
    {
      title: t('rssProductTitle', { name: product.name }),
      link: `${url.origin}/p/${product.id}`,
      description: t('rssProductDescription', { name: product.name }),
      self: url.href,
      language: locals.locale,
    },
    productItems(product, url.origin),
  );
  return new Response(xml, { headers: RSS_HEADERS });
};
