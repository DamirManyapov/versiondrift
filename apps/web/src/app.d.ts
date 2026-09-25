import type { Locale } from '$lib/i18n';

declare global {
  namespace App {
    interface Locals {
      locale: Locale;
      theme: 'dark' | 'light' | 'auto';
    }
    interface PageData {
      locale: Locale;
    }
  }
}

export {};
