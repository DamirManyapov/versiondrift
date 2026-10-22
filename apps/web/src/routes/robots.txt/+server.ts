import { mode } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** The public site is open to crawlers and names its sitemap; a self-hosted instance is private (docs/01). */
export const GET: RequestHandler = ({ url }) => {
  const body =
    mode() === 'selfhosted'
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
