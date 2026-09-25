import type { Locale } from '$lib/i18n';

declare global {
  namespace App {
    interface Locals {
      locale: Locale;
      theme: 'dark' | 'light' | 'auto';
    }
    interface PageData {
      locale: Locale;
      mode: 'public' | 'selfhosted';
    }
    /** Cloudflare (adapter-cloudflare) only; absent in the Node/Docker build. */
    interface Platform {
      caches?: { default: Cache };
      ctx?: { waitUntil(promise: Promise<unknown>): void };
    }
  }
}

export {};
