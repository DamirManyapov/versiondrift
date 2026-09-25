import { describe, expect, it } from 'vitest';
import { localeFromHeader, translator } from '../src/lib/i18n/index.ts';

describe('i18n', () => {
  it('interpolates and picks plural forms per locale', () => {
    const en = translator('en');
    const ru = translator('ru');
    expect(en('products', { n: 1 })).toBe('1 product');
    expect(en('products', { n: 5 })).toBe('5 products');
    expect([1, 3, 5, 21, 22, 25].map((n) => ru('products', { n }))).toEqual([
      '1 продукт',
      '3 продукта',
      '5 продуктов',
      '21 продукт',
      '22 продукта',
      '25 продуктов',
    ]);
    expect(en('feedError', { message: 'HTTP 500' })).toBe('Could not load the feed: HTTP 500');
  });

  it('reads Accept-Language by preference and falls back to English', () => {
    expect(localeFromHeader('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(localeFromHeader('de-DE,de;q=0.9,ru;q=0.5,en;q=0.7')).toBe('en');
    expect(localeFromHeader('de')).toBe('en');
    expect(localeFromHeader(null)).toBe('en');
  });
});
