# 09 — Roadmap & sprints

Assumption: one developer part-time with Claude Code, **sprints of 2 weeks** (≈ 15–25 focused hours).
Each sprint ends with something usable. Tasks are sized to be handed to Claude Code one at a time
("Implement S1-T3 from docs/09-roadmap.md").

Current sprint: **S0**

---

## S0 — Bootstrap (2–4 days)

Goal: an empty but well-wired monorepo.

- S0-T1 ✅ pnpm workspace, TS project refs, ESLint/Prettier, Vitest, `.editorconfig`, Node 22 `.nvmrc`.
- S0-T2 ✅ `packages/schema` with zod `Module` schema per `docs/02`; `pnpm schema:gen` → `schemas/module.schema.json`
  (replace the hand-written draft); `pnpm modules:validate`.
- S0-T3 ✅ GitHub Actions `ci.yml` (lint, typecheck, test, schema drift).
- S0-T4 Repo hygiene: LICENSE (per ADR-0005), CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue templates (bug, module request).
- S0-T5 ✅ Register domain(s), create Cloudflare account resources: R2 bucket, Pages project, DNS `feed.` and apex.

**Done when:** `pnpm i && pnpm -r test && pnpm modules:validate` pass in CI on the example modules.

## S1 — Feed: collector + first 15 modules

Goal: `https://feed.versiondrift.dev/v1/index.json` updates daily with real data.

- S1-T1 `packages/core`: version schemes `semver`, `loose`, `debian` (+ property tests), `trackOf`, `branchOf`.
- S1-T2 Adapter framework: `Fetcher` with ETag cache, per-host rate limiter, fixtures recorder.
- S1-T3 Adapters: `github`, `rss`, `html`, `dockerhub`, `endoflife`.
- S1-T4 Classification v1: section mapping + keyword rules (no LLM).
- S1-T5 Collector CLI: `collect`, `build` (index/product/catalog/health/week), merge with previous, guardrails.
- S1-T6 Publish to R2 with wrangler; minisign signing; `collect.yml` cron.
- S1-T7 Verify & fix the 10 example modules; add 5 more from the author's stack (zabbix, postgresql, nginx, minio,
  proxmox-backup-server).
- S1-T8 `module-pr.yml` bot comment with parsed releases.

**Done when:** feed is published by cron 3 days in a row; health ≥ 90 %; the author can open product JSONs and
they are correct for Grafana, Debian, poste.io.

## S2 — Public board with *my versions*  ← versions come in this sprint

Goal: the author uses `versiondrift.dev` for his own stack.

- S2-T1 SvelteKit app skeleton, tokens, layout, i18n (en/ru), `FeedClient`.
- S2-T2 `BrowserInventoryStore` (localStorage + import/export YAML).
- S2-T3 Status engine in `core` (`computeStatus`, `changelog`) — without advisories yet (critical comes in S3).
- S2-T4 Board: summary strip, filters, tiles, sorting, detail panel (Changes + Module tabs), version picker,
  "I've updated", track selector.
- S2-T5 Catalog modal/page; demo board on first visit.
- S2-T6 `/week` view from `week/*.json` + board filter.
- S2-T7 `/p/:id` product page (basic).
- S2-T8 Deploy with `adapter-cloudflare` to Pages; `/status` page from `health.json`.
- S2-T9 `notify` CLI — Telegram alerts long before self-hosted: reads the published feed + an `inventory.yaml`
  (same format as `docs/07-self-hosted.md`), runs `computeStatus`, sends a Telegram message when a product's status
  changes (`update`, `eol`; `critical` automatically once S3 lands) and a weekly digest; remembers what was sent in a
  small state file. Runs from cron on any server or from a scheduled GitHub Actions workflow in a **separate private
  repo** (inventory + bot token as secrets, never in this repo). Becomes the Telegram channel of S5-T5.

**Done when:** the author's board (≥ 12 products with versions) shows correct `update/ok/eol` states and changelogs,
and the author gets Telegram messages about their own stack without opening the site.

## S3 — Security

Goal: red tiles are real.

- S3-T1 Adapters `osv`, `ghsa`, `nvd`, `debian`, `kev`; advisory merge by aliases; severity mapping.
- S3-T2 `isAffected` with OSV ranges; advisory ↔ release linking; synthetic "Fixes CVE" items.
- S3-T3 Status `critical`, Vulnerabilities tab, CVSS tiles, KEV badge, settings threshold.
- S3-T4 Optional LLM classification + release summaries (budgeted, cached, labelled).
- S3-T5 "Important only" toggle; "Copy as Markdown".
- S3-T6 Light theme; accessibility pass (keyboard, contrast, screen reader labels).

**Done when:** a known historical CVE for Grafana/Elasticsearch marks an old version red and shows the fixing release.

## S4 — Share & grow (public launch v0.1)

- S4-T1 Share links (`/b#s=…`), read-only shared board, "save to my board".
- S4-T2 Compare pages `/p/:id/:a...:b` and version pages `/p/:id/v/:v` (SSR in Workers, edge cache), canonical URLs.
- S4-T3 Sitemap, JSON-LD, OG images.
- S4-T4 RSS: per product, per board (hash of inventory), weekly.
- S4-T5 Grow catalog to 60+ modules (priority list in `docs/11`).
- S4-T6 Landing section on `/` for first-time visitors (what it is, 3 modes, GitHub link).
- S4-T7 Launch checklist (`docs/11`).

## S5 — Self-hosted v0.1

- S5-T1 `adapter-node` build, Dockerfile (multi-stage, non-root, multi-arch), GHCR release workflow.
- S5-T2 Drizzle schema + SQLite store, migrations; multiple boards; instances.
- S5-T3 Auth modes none/password/oidc/trusted-header.
- S5-T4 Feed sync with signature verification; offline mode flag (runs collector in-process).
- S5-T5 Notifications: Telegram, e-mail, ntfy, Gotify, webhook; rules; weekly digest.
- S5-T6 `inventory.yaml` watch/import; docs for compose + reverse proxy.

## S6 — Detection & integrations

- S6-T1 `apps/detector` with `http`, `docker`, `sql`, `snmp`, `ssh`+`command`/`file`/`dpkg`.
- S6-T2 Zabbix integration; Proxmox VE integration; Ansible facts import.
- S6-T3 Instances UI: "2 of 5 affected", per-host list, last detected.
- S6-T4 Private modules directory; Debian security by detected packages.
- S6-T5 Helm chart, Proxmox helper script.

## S7 — Accounts on the public site

- per `docs/08-accounts.md`: auth, D1, import from browser, alerts (Queues), Telegram bot linking, weekly e-mail.

## S8 — Community & 1.0

- Module contribution flow polished (templates, bot, "good first module" issues), maintainers per category.
- 150+ modules; docs site; public API docs for the feed.
- Stability: feed format frozen as v1; semver releases of the image.

## Later / ideas backlog

- Teams (shared boards, SSO, roles, API keys) — the potential paid tier.
- CLI / GitHub Action `versiondrift check --fail-on critical` for CI/IaC repos (parse Dockerfiles, Helm values, Ansible vars).
- Telegram bot as a standalone client (`/add grafana 11.3.1`).
- Grafana plugin / Homepage & Homarr widgets / Uptime-Kuma style status embeds.
- Upgrade path advisor: "11.3 → 11.6 → 12.x" from breaking changes and vendor upgrade docs.
- Contributor leaderboard, module quality score.
