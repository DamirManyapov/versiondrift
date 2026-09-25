import { getContext, setContext } from 'svelte';
import { translator, type Locale, type Translate } from './index.ts';

const KEY = Symbol('i18n');

export interface I18n {
  readonly locale: Locale;
  readonly t: Translate;
}

/** Called by the root layout; `getLocale` is reactive (it reads layout data). */
export function setI18n(getLocale: () => Locale): void {
  setContext<I18n>(KEY, {
    get locale() {
      return getLocale();
    },
    get t() {
      return translator(getLocale());
    },
  });
}

export const i18n = (): I18n => getContext<I18n>(KEY);
