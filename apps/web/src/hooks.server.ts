import { dev } from '$app/environment';
import type { Handle, HandleFetch } from '@sveltejs/kit';
import { isLocale, localeFromHeader } from '$lib/i18n';

// Language: the vd_lang cookie (set in the footer), else Accept-Language. Theme: the vd_theme cookie, else auto.
export const handle: Handle = async ({ event, resolve }) => {
  const cookie = event.cookies.get('vd_lang');
  const locale = isLocale(cookie) ? cookie : localeFromHeader(event.request.headers.get('accept-language'));
  const themeCookie = event.cookies.get('vd_theme');
  const theme = themeCookie === 'dark' || themeCookie === 'light' ? themeCookie : 'auto';
  event.locals.locale = locale;
  event.locals.theme = theme;
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', locale).replace('%theme%', theme),
    // FeedClient reads ETags of feed responses in universal loads.
    filterSerializedResponseHeaders: (name) => name === 'etag' || name === 'content-type',
  });
};

// Dev only (removed from builds): server-side loads read the local feed that vite serves at /feed/ in the browser.
export const handleFetch: HandleFetch = async ({ request, fetch }) => {
  if (dev) {
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
