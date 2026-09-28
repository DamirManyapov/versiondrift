// A small typed i18n (ADR-0006): en is the source of keys, ru must provide the same ones.
import { en } from './en.ts';
import { ru } from './ru.ts';

export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

type PluralForms = { one: string; few?: string; many?: string; other: string };
type Message = string | PluralForms;
export type Messages = { [K in keyof typeof en]: (typeof en)[K] extends string ? string : PluralForms };
export type MessageKey = keyof Messages;

const MESSAGES: Record<Locale, Messages> = { en, ru };

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** For keys built at run time ("pollExplain_" + an error code). */
export const isMessageKey = (key: string): key is MessageKey => key in en;

/** Picks a locale from an Accept-Language header ("ru-RU,ru;q=0.9,en;q=0.8" → ru). */
export function localeFromHeader(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(
        params
          .find((p) => p.trim().startsWith('q='))
          ?.trim()
          .slice(2) ?? 1,
      );
      return { lang: tag.toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);
  return ranked.map((r) => r.lang).find(isLocale) ?? DEFAULT_LOCALE;
}

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const messages = MESSAGES[locale];
  const rules = new Intl.PluralRules(locale);
  return (key, params = {}) => {
    const message: Message = messages[key];
    if (typeof message === 'string') return interpolate(message, params);
    const n = Number(params.n ?? 0);
    const form = rules.select(n) as keyof PluralForms;
    return interpolate(message[form] ?? message.other, { ...params, n });
  };
}

/** A module category ("ci-cd") in the reader's language; unknown ids show as they are. */
export function categoryLabel(t: Translate, id: string): string {
  const key = `cat_${id}`;
  return key in en ? t(key as MessageKey) : id;
}
