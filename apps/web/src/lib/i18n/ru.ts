import type { Messages } from './index.ts';

// Russian messages: same keys as en.ts; plural forms one / few / many.
export const ru: Messages = {
  appTagline: 'Насколько ваш стек отстал от апстрима.',
  navBoard: 'Доска',
  navWeek: 'За неделю',
  navCatalog: 'Каталог',
  navStatus: 'Статус фида',
  feedUpdated: 'Фид обновлён',
  refresh: 'Обновить',
  addProduct: 'Продукт',
  loading: 'Загрузка…',
  feedError: 'Не удалось загрузить фид: {message}',
  products: { one: '{n} продукт', few: '{n} продукта', many: '{n} продуктов', other: '{n} продукта' },
  latest: 'Последняя',
  language: 'Язык',
  theme: 'Тема',
  themeAuto: 'Авто',
  themeDark: 'Тёмная',
  themeLight: 'Светлая',
  footerData: 'Данные о релизах — из источников вендоров · фид под CC BY 4.0',
  footerCode: 'Код под AGPL-3.0',
  today: 'сегодня',
  yesterday: 'вчера',
};
