# CLAUDE.md — VersionDrift

> Working name: **VersionDrift** (domain candidates: `versiondrift.dev`, `versiondrift.io`).
> If the project is renamed, do a single repo-wide search/replace of `VersionDrift` / `versiondrift`.

## What this project is

VersionDrift shows **how far your software stack has drifted from upstream**: for every product you run
(Grafana, Debian, Elasticsearch, poste.io, Proxmox VE, …) it shows your version, the latest version,
everything that changed in between (with security / breaking changes highlighted) and a colour status:

| Status | Meaning |
|---|---|
| `critical` (red) | an advisory affects your version with CVSS ≥ threshold (default 7.0), or it is in CISA KEV |
| `eol` (dark) | your release branch is end-of-life |
| `update` (amber) | newer releases exist in your track |
| `ok` (green) | you are on the latest release of your track |
| `news` (neutral) | no version set — tile shows recent news only |
| `stale` (grey, dashed) | the product's data could not be collected recently |

Products are described by small **YAML modules** in `products/` that the community adds via PRs.

Read `docs/00-vision.md` first, then `docs/01-architecture.md`. The current sprint is in `docs/09-roadmap.md`.

## Non-negotiable principles

1. **Product data is public, inventory is private.** The public feed never contains anything about a user.
   In anonymous mode the user's versions live only in the browser (localStorage / URL fragment).
   In self-hosted mode they never leave the instance. In account mode we store only `product + version (+ optional label)`,
   never hostnames or IPs.
2. **Collect once, serve many.** Vendor sites / APIs are hit only by the central collector. Self-hosted instances
   pull the signed feed by default; running their own collector is an opt-in "offline mode".
3. **One codebase, several deployment targets.** The same SvelteKit app runs on Cloudflare (public site) and in
   Node/Docker (self-hosted). Storage is abstracted (browser / D1 / SQLite via Drizzle).
4. **Modules are data, not code.** Adding a product must not require TypeScript. New *source types* are code
   (adapters) and are rare.
5. **Link, don't copy.** Store short change bullets and a link to the original release notes, not full copies.
6. **Every automatic judgement is labelled.** Items classified by keyword rules or an LLM carry `classifiedBy`.

## Tech stack (decided — see `docs/adr/`)

- TypeScript everywhere, Node 22 LTS, **pnpm workspaces** monorepo.
- `zod` for runtime schemas; JSON Schema in `schemas/` is generated from zod (`pnpm schema:gen`) and is what
  module authors' editors use.
- **Collector**: Node script run by GitHub Actions cron (daily, plus manual dispatch). Publishes the feed to
  Cloudflare R2 (`feed.versiondrift.dev`).
- **Web app**: SvelteKit + TypeScript. `adapter-cloudflare` for the public site, `adapter-node` for the Docker image.
- **DB**: Drizzle ORM — Cloudflare D1 (public accounts) and SQLite/better-sqlite3 (self-hosted).
- Tests: Vitest (unit), Playwright (e2e). Lint/format: ESLint + Prettier.
- Styling: plain CSS with design tokens (`apps/web/src/lib/styles/tokens.css`); fonts IBM Plex Sans / IBM Plex Mono.

## Repository layout (target)

```
products/                 # community modules, one YAML per product (+ _template.yaml)
schemas/                  # generated JSON Schemas (module, feed)
packages/
  schema/                 # zod schemas + types: Module, FeedIndex, FeedProduct, Inventory
  core/                   # version schemes, comparison, status engine, affected-range matching
  adapters/               # source adapters: github, gitlab, rss, html, dockerhub, endoflife, osv, ghsa, debian, kev
  classify/               # change-item classification: structured → keywords → LLM (optional)
apps/
  collector/              # CLI: validate modules, collect, build feed, publish, health report
  web/                    # SvelteKit app (public + self-hosted)
  detector/               # (sprint 6) version detection runner used by self-hosted
docs/                     # specs, ADRs, roadmap
design/                   # prototype + design notes
.github/workflows/        # ci.yml, collect.yml, module-pr.yml, release.yml
```

## Commands (to be created in Sprint 0 — keep this list in sync)

```bash
pnpm i                             # pnpm version is pinned in package.json "packageManager"
pnpm -r test                       # all unit tests (`pnpm vitest` at the root = watch mode over all packages)
pnpm lint && pnpm typecheck        # lint = ESLint (type-aware) + prettier --check; typecheck = tsc -b
pnpm format                        # prettier --write (skips docs/, design/, products/, schemas/, *.md)
pnpm schema:gen                    # zod → schemas/*.json
pnpm modules:validate              # validate every products/*.yaml against the schema
pnpm collect --only grafana,debian --out ./.feed   # local collector run, no publish
pnpm collect --dry-run             # fetch + build, print diff vs. published feed
pnpm web:dev                       # SvelteKit dev server using ./.feed or FEED_URL
pnpm web:build:cf | web:build:node
docker build -t versiondrift .     # self-hosted image
```

## Conventions

- Package layout: `src/` is compiled by the package's own `tsconfig.json` (extends `tsconfig.base.json`,
  `rootDir: src`, `outDir: dist`); tests are `test/*.test.ts`, type-checked by the root `tsconfig.json`.
  A new package must be added to the root `tsconfig.json` `references`. Shared dev tools (`typescript`,
  `vitest`, `@types/node`) are declared as `"catalog:"` — versions live in `pnpm-workspace.yaml`.
- TypeScript is erasable-only (`erasableSyntaxOnly`): no `enum`, `namespace` or parameter properties —
  use `as const` objects / string unions.
- Module ids: lowercase kebab-case, stable forever (`percona-xtradb-cluster`). Renames need an `aliases` entry.
- All dates in the feed are ISO 8601 UTC (`2026-09-22T00:00:00Z`) — date-only sources use midnight UTC.
- Versions are stored as the vendor writes them (`v` prefix stripped) plus a normalized `sortKey` from `packages/core`.
- Never throw away a product's data on a failed collection: keep the last good snapshot, mark `stale`.
- Adapters must be pure w.r.t. network access through an injected `fetcher` (so tests use recorded fixtures).
  Fixtures live in `packages/adapters/test/fixtures/<adapter>/`.
- Conventional Commits (`feat(collector): …`, `module(grafana): …`).
- User-facing strings go through i18n (`en` first, `ru` second).
- Accessibility: real buttons/links, focus rings, colour is never the only signal (status chips carry text).

## Definition of done (every task)

- Types pass, lint passes, unit tests for new logic, fixtures for new adapters.
- Docs in `docs/` updated if behaviour or formats changed (feed format changes bump `formatVersion`).
- For modules: `pnpm modules:validate` and `pnpm collect --only <id>` both succeed.

## Where things are specified

| Topic | Doc |
|---|---|
| Product vision, modes, audience | `docs/00-vision.md` |
| Architecture, data flow, deployment | `docs/01-architecture.md` |
| Module YAML format | `docs/02-module-spec.md`, `schemas/module.schema.json` |
| Feed JSON format | `docs/03-feed-format.md`, `schemas/feed-product.schema.json` |
| Collector internals, classification, CVE matching | `docs/04-collector.md` |
| Version comparison & status rules | `docs/05-status-engine.md` |
| Screens, routes, UI behaviour | `docs/06-ui-spec.md` |
| Self-hosted (Docker, detectors, notifications) | `docs/07-self-hosted.md` |
| Accounts on the public site | `docs/08-accounts.md` |
| Sprints and acceptance criteria | `docs/09-roadmap.md` |
| How to contribute a module | `docs/10-contributing-modules.md` |
| Launch, growth, naming | `docs/11-launch-and-growth.md` |
| Risks, open questions | `docs/12-risks-and-open-questions.md` |
| Decisions | `docs/adr/*.md` |
