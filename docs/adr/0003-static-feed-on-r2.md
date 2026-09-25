# ADR-0003: Public data as a static, signed feed on R2

Status: accepted · 2026-09-25

## Decision
The collector runs in GitHub Actions and publishes static JSON to Cloudflare R2 behind `feed.versiondrift.dev`.
No database for public product data. `index.json` is signed with minisign.

## Why
Zero hosting cost, cacheable, trivially consumable by self-hosted instances and third parties,
auditable (every run's diff is visible in the Actions log).

## Consequences
Queries across products (search, weekly digest) are precomputed at build time (`catalog.json`, `week/*.json`).
