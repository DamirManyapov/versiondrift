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
- **HTTP cache** (ETag/Last-Modified) in the private R2 bucket `versiondrift-state` under `http-cache/`, to stay
  within API limits,
- **LLM cache** keyed by `sha256(productId + version + notesText)` in `versiondrift-state` under `llm-cache/`.

State lives in its own bucket because everything in `versiondrift-feed` is public.

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
| Repo, CI, collector runs | GitHub (private until the public launch in S4: 2 000 free Actions minutes/month; then public, unlimited) | 0 |
| Feed | Cloudflare R2 bucket `versiondrift-feed`, public via custom domain `feed.versiondrift.dev` | free tier (10 GB, no egress fees) |
| Collector state | Cloudflare R2 bucket `versiondrift-state`, private | free tier |
| Public site | Cloudflare Pages/Workers (`versiondrift.dev`) | free tier initially |
| Accounts DB | Cloudflare D1 | free tier initially |
| E-mail | Resend / Postmark / Amazon SES (pick at Sprint 7) | low |
| Self-hosted image | GHCR `ghcr.io/<org>/versiondrift` (multi-arch amd64/arm64) | 0 |
| Docs site | the SvelteKit app's `/docs` or Starlight on Pages | 0 |

Secrets (GitHub Actions): `GITHUB_TOKEN` (built-in, for GitHub API), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
(the names wrangler reads; a CI-only token limited to R2 — plus Pages from S2-T8), `NVD_API_KEY` (optional),
`LLM_API_KEY` (optional), `MINISIGN_SECRET_KEY`.

### Provisioned resources (S0-T5)

- Zone `versiondrift.dev` on Cloudflare (Free plan). DNS: `versiondrift.dev` CNAME `versiondrift.pages.dev` and
  `feed.versiondrift.dev` → R2 custom domain, both proxied. No `www` yet.
- R2 `versiondrift-feed`: public only through `feed.versiondrift.dev` (the `r2.dev` URL is disabled), min TLS 1.2,
  CORS `GET, HEAD` from any origin with `ETag` / `Last-Modified` exposed. `Cache-Control` is set per object at
  upload (`docs/03-feed-format.md`).
- R2 `versiondrift-state`: no public access.
- Pages project `versiondrift` (direct upload, production branch `main`), custom domain `versiondrift.dev`.
  Serves `apps/web` (SSR in Pages Functions / Workers) since S2-T8, deployed by `.github/workflows/deploy-web.yml` on
  every push to `main` that touches the app, `core` or `schema` (`wrangler pages deploy`, then a smoke test).
  `/robots.txt` (a route, not a static file) allows crawling and names `/sitemap.xml` on the public site; a
  self-hosted instance answers `Disallow: /` (also without signing in) and sends `X-Robots-Tag: noindex, nofollow`.

## Feed integrity

The collector signs `index.json` with minisign (Ed25519, prehashed "ED" format); product files are referenced from
the index by `sha256`. The public key is `keys/feed.pub` in this repository:

```
untrusted comment: minisign public key C47B6424FAAC40B9
RWS5QKz6JGR7xISHHllazU/WZfqYkET1YLLxuKPMlK8s7N13793Wd/2N
```

Anyone can check the feed with the stock tool: `minisign -Vm index.json -P RWS5QKz6JGR7xISHHllazU/WZfqYkET1YLLxuKPMlK8s7N13793Wd/2N`
(download `v1/index.json` and `v1/index.json.minisig`), then compare each product file's sha256 with the index.
The trusted comment carries `timestamp`, `file` and the index's sha256. Self-hosted verifies the signature with the
public key baked into the image (overridable for forks/private feeds). The secret key lives only in the
`MINISIGN_SECRET_KEY` Actions secret and the maintainer's backup (`pnpm collector keygen` creates a new pair).

## Scaling notes

- 1 000 products × ~50 releases × ~2 KB ≈ 100 MB raw; per-product files keep the **last 100 releases** or 3 years,
  whichever is larger; older releases go to `products/<id>/archive-<year>.json`.
- GitHub API: authenticated 5 000 req/h in Actions; conditional requests (ETag) return 304 which don't count against
  the primary limit for authenticated requests (verify in Sprint 1) — plus incremental "since last seen tag".
- Compare pages (`/p/<id>/<a>...<b>`) are rendered on demand in Workers and cached at the edge for 10 minutes
  (Cache API in `hooks.server.ts`; the feed changes once a day).
