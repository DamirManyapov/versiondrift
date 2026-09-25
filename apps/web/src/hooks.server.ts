import { building, dev } from '$app/environment';
import type { Handle, HandleFetch, ServerInit } from '@sveltejs/kit';
import { isLocale, localeFromHeader } from '$lib/i18n';
import { json } from '@sveltejs/kit';
import { bootstrapAdmin, crossSite, currentUser, isOpenPath } from '$lib/server/auth';
import { startFeedSync } from '$lib/server/feed-sync';
import { mode, selfHostedStore } from '$lib/server/storage';

// Self-hosted, before the first request: the first board and the admin user exist, and the feed mirror is kept fresh (not during
// `vite build`, which also loads this file).
export const init: ServerInit = async () => {
  if (mode() !== 'selfhosted' || building) return;
  selfHostedStore().defaultBoard();
  await bootstrapAdmin();
  startFeedSync();
};

// Language: the vd_lang cookie (set in the footer), else Accept-Language. Theme: the vd_theme cookie, else auto.
export const handle: Handle = async ({ event, resolve }) => {
  const cookie = event.cookies.get('vd_lang');
  const locale = isLocale(cookie) ? cookie : localeFromHeader(event.request.headers.get('accept-language'));
  const themeCookie = event.cookies.get('vd_theme');
  const theme = themeCookie === 'dark' || themeCookie === 'light' ? themeCookie : 'auto';
  event.locals.locale = locale;
  event.locals.theme = theme;

  if (crossSite(event.request, event.url))
    return json({ message: 'Cross-site request refused' }, { status: 403 });

  // Self-hosted: every page and API call needs a signed-in user, except sign-in itself and /healthz.
  if (mode() === 'selfhosted') {
    await bootstrapAdmin();
    const user = currentUser(event);
    if (user) event.locals.user = user;
    const { pathname, search } = event.url;
    const api = pathname.startsWith('/api/');
    if (!user && !isOpenPath(pathname)) {
      if (api || event.request.method !== 'GET') return json({ message: 'Sign in first' }, { status: 401 });
      return new Response(null, {
        status: 303,
        headers: { location: `/login?next=${encodeURIComponent(pathname + search)}` },
      });
    }
    if (user?.role === 'viewer' && api && event.request.method !== 'GET')
      return json({ message: 'Viewers cannot change boards' }, { status: 403 });
  }
  const render = async () => {
    const response = await resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%lang%', locale).replace('%theme%', theme),
      // FeedClient reads ETags of feed responses in universal loads.
      filterSerializedResponseHeaders: (name) => name === 'etag' || name === 'content-type',
    });
    // A self-hosted instance is private: keep it out of search engines even if it is reachable.
    if (mode() === 'selfhosted') response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  };

  // Edge cache for server-rendered product, compare and version pages, RSS and the sitemap on Cloudflare
  // (docs/01): the feed changes once a day, so a response is reused for as long as its Cache-Control allows.
  // Language and theme are part of the key because the output depends on them.
  const cache = event.platform?.caches?.default;
  const { pathname } = event.url;
  const cacheable = pathname.startsWith('/p/') || pathname.startsWith('/rss/') || pathname === '/sitemap.xml';
  if (!cache || event.request.method !== 'GET' || !cacheable) return render();
  const key = new URL(event.url);
  key.searchParams.set('__vd', `${locale}.${theme}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await render();
  if (response.status === 200 && response.headers.get('cache-control')?.startsWith('public'))
    event.platform?.ctx?.waitUntil(cache.put(key, response.clone()));
  return response;
};

// Dev only (removed from builds): server-side loads read the local feed that vite serves at /feed/ in the browser.
export const handleFetch: HandleFetch = async ({ request, fetch }) => {
  if (dev && mode() !== 'selfhosted') {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/feed/')) {
      const { readFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const dir = path.resolve(process.env.FEED_DIR ?? '../../.feed');
      try {
        const body = await readFile(path.join(dir, decodeURIComponent(url.pathname.slice('/feed'.length))));
        return new Response(body, { headers: { 'content-type': 'application/json' } });
      } catch {
        return new Response('', { status: 404 });
      }
    }
  }
  return fetch(request);
};
