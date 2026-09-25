import type { Locale } from '$lib/i18n';

declare global {
  namespace App {
    interface Locals {
      locale: Locale;
      theme: 'dark' | 'light' | 'auto';
      /** Self-hosted: the signed-in user (docs/07 "Auth"). */
      user?: { id: number; name: string; email: string | null; role: 'admin' | 'viewer' };
    }
    interface PageData {
      locale: Locale;
      mode: 'public' | 'selfhosted';
      /** Self-hosted: who is signed in and how sign-in works; null on the public site. */
      account: {
        name: string;
        role: 'admin' | 'viewer';
        auth: 'none' | 'password' | 'oidc' | 'header';
      } | null;
    }
    /** Cloudflare (adapter-cloudflare) only; absent in the Node/Docker build. */
    interface Platform {
      caches?: { default: Cache };
      ctx?: { waitUntil(promise: Promise<unknown>): void };
    }
  }
}

export {};
