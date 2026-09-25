import type { Locale, Translate } from './i18n/index.ts';

/** "today 02:14 UTC", "yesterday 02:14 UTC", "24 Sep 02:14 UTC". */
export function formatUpdated(iso: string, locale: Locale, t: Translate, now = new Date()): string {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const label =
    day(date) === day(now)
      ? t('today')
      : day(date) === day(yesterday)
        ? t('yesterday')
        : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  return `${label} ${time} UTC`;
}

/** "15 Sep 2026" in the user's language. */
export const formatDate = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
