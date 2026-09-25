# 00 — Vision

## Problem

A sysadmin / DevOps engineer runs dozens of products: an OS, monitoring, logging, mail, virtualization,
network gear, databases. Keeping up means watching GitHub releases, vendor blogs, mailing lists, security
trackers and changelog pages — each in a different place and format. In practice people stop following,
and months later discover they are three majors and two critical CVEs behind.

Existing tools cover pieces:

| Tool | Gives | Missing |
|---|---|---|
| NewReleases.io, Argus, Diun | "a new version exists" notifications | no link to *your* version, no security/breaking view, weak for non-GitHub vendors |
| endoflife.date | lifecycle / EOL per branch | no changes, no CVEs |
| OpenCVE, OSV, NVD | vulnerabilities | not per-product "what should I do", no release context |
| RSS readers | raw news | noise, no status, nothing version-aware |

## Solution

One board of the products you care about. For each one: **your version → latest**, a colour status, and a
merged changelog *from your version to latest* with security, breaking and deprecated items highlighted,
plus the CVEs that affect your version. A weekly feed answers "what shipped this week that matters to me?".

The key differentiator is **version awareness**: everything is computed relative to what you actually run.

## Audience

1. **Homelab / self-hosting enthusiasts** — many products, little time. Discover via r/selfhosted,
   awesome-selfhosted, Habr, YouTube. Want Docker, no account.
2. **Sysadmins / DevOps in small and mid companies** — the author's own case (hundreds of servers, Proxmox,
   MikroTik, Percona, ELK, Grafana). Want auto-detection, alerts, multiple instances per product.
3. **People googling "X 11 to 12 breaking changes"** — arrive at public compare pages; the top of the funnel.
4. **Teams / organizations** (later) — shared boards, SSO, integrations. Potential revenue.

## Product modes (one codebase)

| Mode | Storage of user's stack | Auth | Unique capabilities |
|---|---|---|---|
| **Public, anonymous** | browser localStorage + share link | none | everything visible, zero setup, compare pages, RSS |
| **Public, account** | D1: product + version (+ label) | magic link / GitHub / Google | sync across devices, e-mail/Telegram alerts, weekly digest |
| **Self-hosted** | SQLite in the container | none / password / OIDC | auto-detection inside the network, instances per host, private modules, offline mode |
| **Teams** (later) | cloud or self-hosted | SSO | shared boards, roles, API keys, integrations |

## Core user stories

- As a visitor, I open the site and immediately see a demo board and can browse any product's recent changes without signing up.
- As a user, I add products to my board from a catalog and optionally set my version per product.
- As a user, I see a red tile when an advisory affects my version, and clicking it shows exactly which releases fix it.
- As a user, I can pin a **track** (e.g. "Elasticsearch 8.x") so "latest" means latest in my track.
- As a user, I open "This week" on Sunday evening and see everything that shipped for my products in 7 days.
- As a user, I share my board with a colleague by link, no account needed.
- As a self-hoster, my versions are detected automatically from Grafana's `/api/health`, `pveversion`, SNMP, Zabbix inventory, etc.
- As a self-hoster with 5 Grafana instances, I see "2 of 5 affected" and which hosts.
- As a contributor, I add a missing product by writing one YAML file; CI tells me if it works.
- As a searcher, I land on `/p/grafana/11.3.1...12.1.2` and see the merged changelog and CVEs between those versions.

## Non-goals (for now)

- Patching / upgrading software for the user (we inform, we don't act).
- Language-package dependency scanning (Dependabot/Renovate territory) — we track *deployed products*.
- Full vulnerability management (asset DB, SLA tracking).
- Mobile apps (responsive web is enough).

## Success metrics

| Horizon | Metric |
|---|---|
| Sprint 2 | the author uses it weekly for his own stack instead of manual checks |
| Public launch (+1 month) | 100 modules, 500 weekly visitors, 200 GitHub stars |
| +6 months | 300 modules, 25 external module contributors, 2k self-hosted pulls, compare pages ranking for "X to Y changes" |
| Health | ≥ 97 % of modules collected successfully each day; feed published daily |
