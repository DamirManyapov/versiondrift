import type { Handle } from '@sveltejs/kit';
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
  });
};
