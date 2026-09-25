# 08 — Accounts on the public site (Sprint 7)

Goal: sync across devices + alerts, for people who don't want to run Docker.
Anonymous use must stay fully functional; an account is only a storage + notification upgrade.

## Auth

- Magic link by e-mail (primary), GitHub OAuth, Google OAuth. No passwords.
- Library: Lucia-style session handling implemented in SvelteKit hooks (or Auth.js SvelteKit adapter) on Workers.
- Sessions in D1, cookie `__Host-vd_session`, 30-day sliding expiry.

## Data minimisation

Stored per user: e-mail, boards, `product + version + track + optional free-text label` (label limited to 40 chars,
UI warns "don't put hostnames or IPs here"). No hosts, no IPs, no detector configs (those are self-hosted only).
Account deletion = hard delete within 24 h. Export as `inventory.yaml` at any time.

## On first login

"Import board from this browser?" → merges localStorage inventory into the account.

## D1 schema

Same Drizzle schema as self-hosted minus `detectors`, `integrations`, `instances.host`; plus
`auth_sessions`, `auth_keys`, `email_tokens`.

## Alerts

- Cloudflare Cron Trigger after each feed publish (or a webhook from the collector) → Worker computes status diffs
  per board → enqueues to Cloudflare Queues → consumer sends e-mail / Telegram.
- Telegram: users link the bot via `/start <token>` deep link.
- Weekly digest e-mail on Sunday 18:00 in the user's time zone.
- Limits on free tier: 3 boards, 100 products, alerts for critical/eol + weekly digest.

## Abuse & cost controls

Turnstile on magic-link requests, per-IP and per-email rate limits, e-mail provider daily cap alerting.
