# 01 — Architecture

## Two layers

```
┌───────────────────────── PUBLIC DATA LAYER (collect once) ─────────────────────────┐
│                                                                                    │
│  products/*.yaml ──► apps/collector (GitHub Actions, daily 02:00 UTC + dispatch)    │
│                        │  adapters: github · gitlab · rss · html · dockerhub ·     │
│                        │            endoflife · osv · ghsa · nvd · debian · kev    │
│                        │  classify: structured → keywords → LLM (optional)          │
│                        ▼                                                           │
│                 feed/v1/index.json                                                 │
│                 feed/v1/products/<id>.json                                         │
│                 feed/v1/catalog.json   feed/v1/health.json                         │
│                 feed/v1/index.json.minisig                                         │
│                        │  wrangler r2 put                                          │
│                        ▼                                                           │
│              Cloudflare R2  ──►  https://feed.versiondrift.dev/v1/…                │
└────────────────────────┬───────────────────────────────────────────────────────────┘
                         │ read-only, HTTP + ETag
      ┌──────────────────┼───────────────────────────────┐
      ▼                  ▼                               ▼
 Public site        Public site + account           Self-hosted (Docker)
 (CF Pages/Workers) (CF Workers + D1)               (Node + SQLite)
 inventory in       inventory in D1                 inventory in SQLite
 localStorage/URL   alerts via Queues/Cron          detectors + alerts + private modules
```

## Components

### `packages/schema`
zod definitions for `Module`, `FeedIndex`, `FeedProduct`, `Catalog`, `Health`, `Inventory`. Exports TS types.
`pnpm schema:gen` writes JSON Schema to `schemas/` (used by editors via `# yaml-language-server: $schema=`).

### `packages/core`
Pure, dependency-light, runs in browser, Workers and Node:
- version schemes (`semver`, `loose`, `calver`, `debian`, `regex`) → `parse`, `compare`, `sortKey`, `branchOf`
- affected-range matching (OSV-style `introduced` / `fixed` / `last_affected`)
- status engine (`docs/05-status-engine.md`)
- changelog merge: releases between `from` and `to` in a track

### `packages/adapters`
One file per source type implementing:

```ts
interface Adapter<Cfg> {
  type: string;                                   // "github"
  configSchema: z.ZodType<Cfg>;
  fetchReleases?(cfg: Cfg, ctx: Ctx): Promise<RawRelease[]>;
  fetchAdvisories?(cfg: Cfg, ctx: Ctx): Promise<RawAdvisory[]>;
  fetchLifecycle?(cfg: Cfg, ctx: Ctx): Promise<RawBranch[]>;
}
interface Ctx { fetch: Fetcher; cache: HttpCache; log: Logger; since?: string; secrets: Secrets }
```

### `packages/classify`
Turns release-note text into typed items (`security | breaking | deprecated | feature | fix | other`).
Pipeline in `docs/04-collector.md`.

### `apps/collector`
CLI (`commander`): `validate`, `collect`, `build`, `publish`, `health`. State between runs:
- **previous feed** downloaded from R2 (source of truth, used for incremental collection and "keep last good"),
- **HTTP cache** (ETag/Last-Modified) stored in R2 under `state/http-cache/` to stay within API limits,
- **LLM cache** keyed by `sha256(productId + version + notesText)` in `state/llm-cache/`.

### `apps/web` (SvelteKit)
- Routes and screens: `docs/06-ui-spec.md`.
- Data access through a `FeedClient` (fetch + ETag + in-memory/IndexedDB cache) and an `InventoryStore`
  interface with three implementations: `BrowserInventoryStore` (localStorage), `D1InventoryStore`, `SqliteInventoryStore`.
- Build targets: `adapter-cloudflare` (public) and `adapter-node` (Docker). Mode chosen by env `VD_MODE=public|selfhosted`.

### `apps/detector` (Sprint 6)
Runs module `detect` rules and integrations (Zabbix, Proxmox, Ansible facts) on a schedule inside the
self-hosted container; writes `instances` into SQLite.

## Data flow for a status

1. Web loads `index.json` (small: per product latest version, branches, max-severity summary, updatedAt).
2. For products on the board, it loads `products/<id>.json` lazily.
3. `core.computeStatus(product, installedVersion, track, settings)` runs **client-side** (public anonymous) or
   server-side (accounts/self-hosted for alerts). Same function everywhere.

## Deployment

| Piece | Where | Cost |
|---|---|---|
| Repo, CI, collector runs | GitHub (public repo, Actions free for public repos) | 0 |
| Feed | Cloudflare R2 bucket `versiondrift-feed`, public via custom domain `feed.versiondrift.dev` | free tier (10 GB, no egress fees) |
| Public site | Cloudflare Pages/Workers (`versiondrift.dev`) | free tier initially |
| Accounts DB | Cloudflare D1 | free tier initially |
| E-mail | Resend / Postmark / Amazon SES (pick at Sprint 7) | low |
| Self-hosted image | GHCR `ghcr.io/<org>/versiondrift` (multi-arch amd64/arm64) | 0 |
| Docs site | the SvelteKit app's `/docs` or Starlight on Pages | 0 |

Secrets (GitHub Actions): `GITHUB_TOKEN` (built-in, for GitHub API), `CF_API_TOKEN`, `CF_ACCOUNT_ID`,
`NVD_API_KEY` (optional), `LLM_API_KEY` (optional), `MINISIGN_SECRET_KEY`.

## Feed integrity

The collector signs `index.json` with minisign; product files are referenced from the index by `sha256`.
Self-hosted verifies the signature with the public key baked into the image (overridable for forks/private feeds).

## Scaling notes

- 1 000 products × ~50 releases × ~2 KB ≈ 100 MB raw; per-product files keep the **last 100 releases** or 3 years,
  whichever is larger; older releases go to `products/<id>/archive-<year>.json`.
- GitHub API: authenticated 5 000 req/h in Actions; conditional requests (ETag) return 304 which don't count against
  the primary limit for authenticated requests (verify in Sprint 1) — plus incremental "since last seen tag".
- Compare pages (`/p/<id>/<a>...<b>`) are rendered on demand in Workers and cached at the edge by feed ETag.
