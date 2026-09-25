import type { Status } from '@versiondrift/core';

export type Lang = 'en' | 'ru';

export const STATUS_LABEL: Record<Lang, Record<Status, string>> = {
  en: {
    critical: '🟥 critical',
    eol: '⬛ end of life',
    update: '🟧 update available',
    ok: '🟩 up to date',
    news: '⬜ no version',
    stale: '▫️ data stale',
  },
  ru: {
    critical: '🟥 критично',
    eol: '⬛ поддержка закончилась',
    update: '🟧 есть обновление',
    ok: '🟩 актуально',
    news: '⬜ версия не указана',
    stale: '▫️ данные устарели',
  },
};

export const TEXT = {
  en: {
    firstRun: (n: number) => `👋 VersionDrift is now watching ${n} instance${n === 1 ? '' : 's'}.`,
    needAttention: 'Needs attention:',
    allGood: 'Everything is up to date. 🎉',
    newer: (n: number) => `${n} newer release${n === 1 ? '' : 's'}`,
    types: {
      security: 'security',
      breaking: 'breaking',
      deprecated: 'deprecated',
      feature: 'features',
      fix: 'fixes',
      other: 'other',
    },
    critical: 'Security issue affects your version',
    eol: 'Your branch has reached end of life',
    eolSoon: (date: string) => `Your branch reaches end of life on ${date}`,
    update: 'Update available',
    newRelease: 'New release',
    otherTrack: (v: string) => `A newer major is out: ${v}`,
    invalid: (v: string) => `Version "${v}" is not recognised — check your inventory`,
    unknownProduct: (id: string) => `Unknown product "${id}" (not in the feed)`,
    digest: 'Weekly summary',
    shippedThisWeek: 'Released this week:',
    notes: 'release notes',
    test: '✅ VersionDrift can reach this chat.',
  },
  ru: {
    firstRun: (n: number) => `👋 VersionDrift следит за вашим стеком: ${n} экз.`,
    needAttention: 'Требуют внимания:',
    allGood: 'Всё актуально. 🎉',
    newer: (n: number) => `новых релизов: ${n}`,
    types: {
      security: 'безопасность',
      breaking: 'ломающие',
      deprecated: 'устаревшее',
      feature: 'новое',
      fix: 'исправления',
      other: 'прочее',
    },
    critical: 'Уязвимость затрагивает вашу версию',
    eol: 'Поддержка вашей ветки закончилась',
    eolSoon: (date: string) => `Поддержка вашей ветки заканчивается ${date}`,
    update: 'Доступно обновление',
    newRelease: 'Новый релиз',
    otherTrack: (v: string) => `Вышла новая мажорная версия: ${v}`,
    invalid: (v: string) => `Версия «${v}» не распознана — проверьте inventory`,
    unknownProduct: (id: string) => `Неизвестный продукт «${id}» (нет в фиде)`,
    digest: 'Сводка за неделю',
    shippedThisWeek: 'Вышло за неделю:',
    notes: 'что нового',
    test: '✅ VersionDrift может писать в этот чат.',
  },
} satisfies Record<Lang, unknown>;
