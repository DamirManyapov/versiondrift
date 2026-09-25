# ADR-0002: SvelteKit with Cloudflare and Node adapters

Status: accepted · 2026-09-25 (supersedes the earlier "Hono API + separate frontend" idea)

## Context
The public site (Cloudflare) and the self-hosted app (Docker) must share UI and server routes.
Compare pages need SSR for SEO.

## Decision
One SvelteKit app. `adapter-cloudflare` for versiondrift.dev, `adapter-node` for the image.
Platform differences behind interfaces: `InventoryStore`, `FeedClient`, `Scheduler`, `Notifier`.

## Alternatives
- Astro + islands: great for static SEO, weaker for the app-like board and server routes.
- Next.js: heavier on Workers, larger bundles.
- Hono API + SPA: two apps to maintain; SvelteKit endpoints cover the API needs.
