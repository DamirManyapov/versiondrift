# 02 — Module specification (`products/<id>.yaml`)

A module describes **where to find information about one product** and **how to recognise its versions**.
It contains no code. The source of truth is the zod schema in `packages/schema/src/module.ts`;
`pnpm schema:gen` generates `schemas/module.schema.json` from it (never edit that file by hand). Add
`# yaml-language-server: $schema=../schemas/module.schema.json` as the first line for editor validation.

## Full example

```yaml
# yaml-language-server: $schema=../schemas/module.schema.json
id: grafana                      # required, kebab-case, stable forever
name: Grafana                    # required, display name
aliases: [grafana-oss]           # optional, old ids / search synonyms
vendor: Grafana Labs
category: monitoring             # required, one of the categories below
homepage: https://grafana.com
logo: simpleicons:grafana        # optional: "simpleicons:<slug>" or a URL to an SVG in the repo
description: Observability dashboards and alerting.

versionScheme: semver            # semver | loose | calver | debian | regex
# versionRegex: '^v?(\d+)\.(\d+)\.(\d+)$'   # required only for scheme=regex
tagFilter:                       # which upstream tags/releases count as releases
  include: '^v?\d+\.\d+\.\d+$'
  exclude: '(beta|rc|preview|security-\d+)'
prerelease: skip                 # skip | include

tracks:                          # optional: named release lines users can pin
  - id: "12"
    match: '^12\.'
  - id: "11"
    match: '^11\.'
defaultTrack: latest             # "latest" (any) or a track id

sources:
  releases:                      # required: exactly one primary release source
    type: github
    repo: grafana/grafana
  releasesExtra:                 # optional: enrich notes from another source (e.g. vendor changelog page)
    - type: html
      url: https://grafana.com/docs/grafana/latest/whatsnew/
      select: { item: "h2", title: "h2", body: "h2 ~ *" }
  security:                      # optional list
    - type: ghsa
      repo: grafana/grafana
    - type: nvd
      cpe: "cpe:2.3:a:grafana:grafana"
  eol:                           # optional
    type: endoflife
    product: grafana

classify:                        # optional hints for the classifier
  sections:                      # headings in release notes that map to item types
    security: ["Security", "Security fixes"]
    breaking: ["Breaking changes"]
    deprecated: ["Deprecations"]
    feature: ["Features and enhancements"]
    fix: ["Bug fixes"]
  keywords:
    security: ["CVE-", "XSS", "privilege escalation"]
    breaking: ["removed", "no longer supported"]

detect:                          # optional (used by self-hosted detectors, Sprint 6)
  - http: { path: /api/health, jsonPath: $.version, defaultPort: 3000 }
  - docker: { image: grafana/grafana }
  - command: { run: "grafana-server -v", regex: 'Version (\S+)' }

maintainers: ["@github-handle"]  # who to ping when the module breaks
```

## Fields

| Field | Req | Notes |
|---|---|---|
| `id` | ✓ | `^[a-z0-9][a-z0-9-]{1,62}$`, unique across repo, equals file name |
| `name` | ✓ | |
| `category` | ✓ | `os, virtualization, containers, orchestration, monitoring, logging, database, mail, network, web, security, storage, backup, messaging, collaboration, ci-cd, identity, other` |
| `versionScheme` | ✓ | see `docs/05-status-engine.md` |
| `versionRegex` | | required when `versionScheme: regex`; capture groups become numeric segments |
| `branchGroups` | | `versionScheme: regex` only: how many leading capture groups form the branch (default 2) |
| `sources.releases` | ✓ | exactly one primary source |
| `tagFilter` | | regexes applied to raw version strings before parsing |
| `tracks` | | needed when a product has parallel supported lines (ES 8/9, Debian 12/13, PostgreSQL majors). Ids are strings — quote numbers (`id: "12"`), unique, `latest` is reserved |
| `defaultTrack` | | `latest` (default) or one of the track ids |
| `releaseNotesUrl` | | per-release notes page with a `{version}` placeholder (`https://www.zabbix.com/rn/rn{version}`); used as the release link |
| `classify` | | hints; without them the generic pipeline is used |
| `detect` | | list, first match wins |
| `maintainers` | | GitHub handles |

## Source types

| `type` | For | Config | Gives |
|---|---|---|---|
| `github` | GitHub releases (falls back to tags if `useTags: true`) | `repo`, `useTags?`, `notesFrom?: release\|changelogFile`, `changelogPath?`, `versionRegex?` (version from the tag name, e.g. `'^release-(\d+\.\d+\.\d+)
| `gitlab` | GitLab releases | `host?` (default gitlab.com), `project` | releases + notes |
| `gitea` | Gitea/Forgejo/Codeberg | `host`, `repo` | releases + notes |
| `rss` | RSS/Atom feeds | `url`, `versionFrom: title\|link`, `versionRegex` | releases (+ notes from entry body) |
| `html` | changelog pages without a feed | `url`, `select: { item, title, body, date? }`, `versionRegex`, `dateFormat?` | releases + notes |
| `dockerhub` | image tags | `repo` (`analogic/poste.io`), `tagRegex?`, `versionRegex?` | versions + push dates (no notes) |
| `endoflife` | lifecycle | `product` (endoflife.date slug) | branches, EOL dates, LTS flags |
| `osv` | OSV.dev advisories | `ecosystem`, `package` | advisories with affected ranges |
| `ghsa` | GitHub Security Advisories | either `repo` (repository advisories) or `ecosystem`+`package` | advisories with ranges |
| `nvd` | NVD CVE API 2.0 | `cpe` | CVEs + CVSS + CPE ranges |
| `debian` | Debian Security Tracker | `packages: [..] \| fromInventory` | DSA/DLA per release |
| `kev` | CISA KEV catalog (global, not per module) | — | "known exploited" flag by CVE id |
| `manual` | products with no machine-readable source | `file: products/<id>.releases.yaml` | releases maintained by hand |

New source types = new adapter in `packages/adapters` + fixtures + docs row here. `gitlab` and `gitea` are specified
but not implemented yet (a module using them fails collection with "not implemented").

**Versions from text** (`rss`, `html`): `versionRegex` — the first non-empty capture group wins (so alternatives
like `'Debian (\d+\.\d+) released|Updated Debian \d+: (\d+\.\d+) released'` work). Without it, the first
dotted number is used (`v2.0.0`, `12.15`, `8.0.36-28`). RSS/Atom entries that yield no version are skipped as
other news.

**`html` selectors:** `item` matches one element per release. `title`, `date` and `body` are CSS selectors looked up
*inside* the item (or the item itself when it matches). Without `title` the item's text is the title. Without
`body`, an item that is a heading (`h1`–`h6`) owns its following siblings up to the next item — the common
`<h2>1.2.3</h2><ul>…</ul>` layout — otherwise the item's own content is the body. Without `date`, a date is searched
in the title using `dateFormat` (tokens `YYYY MM M DD D MMM`, e.g. `YYYYMMDD`, `D MMM YYYY`) or as an ISO date.
An item that only wraps a heading (`<div class="heading-wrapper"><h2>9.5.4</h2></div>`, select it with
`div.heading-wrapper:has(> h2)`) behaves like the heading. If the title has no date, the start of the body is searched
too ("Released 05. August 2026"). Sibling combinators like `h2 ~ *` don't work (selectors are relative to the item). An `item` selector that
matches nothing is a collection failure, not "no releases".

**`manual` files:** `products/<id>.releases.yaml` is a YAML list of `{ version: "1.2", date?, url?, notes? }`
(quote versions: YAML reads `1.10` as `1.1`); a manual `eol` file lists `{ name, releaseDate?, eolDate?, eol?, lts?,
codename? }`.

## Validation rules (CI)

`pnpm modules:validate` checks rules 1 and 4 plus: valid YAML without duplicate keys, every regex compiles,
no alias equals another module's id. Errors are printed as `file:line:col` (and as PR annotations in GitHub
Actions). `products/_template.yaml` (any file starting with `_`) is only checked against the schema.
Rules 2, 3 and 5 need collected data and run in the collector (`pnpm collect --only <id>`).

1. Schema-valid; `id` == file name.
2. `pnpm collect --only <id>` returns ≥ 1 release, every release version parses under `versionScheme`.
3. Tracks: every release matches at most one track.
4. If `security` has no entries, the module gets a `noSecuritySource` warning shown on its page ("security data not available").
5. HTML modules must include a recorded fixture of the page (bot records it in the PR) so selector breakage is detectable.

## Examples in this repo

`products/` holds 17 modules verified against their live sources on 2026-09-26 (S1-T7), covering every source type
in use: GitHub releases (grafana, elastic stack, nginx with `versionRegex`, minio with `versionScheme: regex`,
rabbitmq, outline, bigbluebutton), GitHub tags (zabbix, percona-xtradb-cluster), RSS (debian, routeros, postgresql),
HTML (poste-io, proxmox-ve and proxmox-backup-server from their roadmap wikis, elastic release-notes pages as an extra
source), Docker Hub (poste-io extra) and endoflife.date. Copy `_template.yaml` for new ones.

Known gaps: debian, routeros and postgresql feeds list only recent releases, so their history grows day by day;
zabbix and percona tags carry no notes (zabbix links to its release notes page).
`; other tags are ignored) | releases + notes |
| `gitlab` | GitLab releases | `host?` (default gitlab.com), `project` | releases + notes |
| `gitea` | Gitea/Forgejo/Codeberg | `host`, `repo` | releases + notes |
| `rss` | RSS/Atom feeds | `url`, `versionFrom: title\|link`, `versionRegex` | releases (+ notes from entry body) |
| `html` | changelog pages without a feed | `url`, `select: { item, title, body, date? }`, `versionRegex`, `dateFormat?` | releases + notes |
| `dockerhub` | image tags | `repo` (`analogic/poste.io`), `tagRegex?` | versions + push dates (no notes) |
| `endoflife` | lifecycle | `product` (endoflife.date slug) | branches, EOL dates, LTS flags |
| `osv` | OSV.dev advisories | `ecosystem`, `package` | advisories with affected ranges |
| `ghsa` | GitHub Security Advisories | either `repo` (repository advisories) or `ecosystem`+`package` | advisories with ranges |
| `nvd` | NVD CVE API 2.0 | `cpe` | CVEs + CVSS + CPE ranges |
| `debian` | Debian Security Tracker | `packages: [..] \| fromInventory` | DSA/DLA per release |
| `kev` | CISA KEV catalog (global, not per module) | — | "known exploited" flag by CVE id |
| `manual` | products with no machine-readable source | `file: products/<id>.releases.yaml` | releases maintained by hand |

New source types = new adapter in `packages/adapters` + fixtures + docs row here. `gitlab` and `gitea` are specified
but not implemented yet (a module using them fails collection with "not implemented").

**Versions from text** (`rss`, `html`): `versionRegex` — the first non-empty capture group wins (so alternatives
like `'Debian (\d+\.\d+) released|Updated Debian \d+: (\d+\.\d+) released'` work). Without it, the first
dotted number is used (`v2.0.0`, `12.15`, `8.0.36-28`). RSS/Atom entries that yield no version are skipped as
other news.

**`html` selectors:** `item` matches one element per release. `title`, `date` and `body` are CSS selectors looked up
*inside* the item (or the item itself when it matches). Without `title` the item's text is the title. Without
`body`, an item that is a heading (`h1`–`h6`) owns its following siblings up to the next item — the common
`<h2>1.2.3</h2><ul>…</ul>` layout — otherwise the item's own content is the body. Without `date`, a date is searched
in the title using `dateFormat` (tokens `YYYY MM M DD D MMM`, e.g. `YYYYMMDD`, `D MMM YYYY`) or as an ISO date.
Sibling combinators like `h2 ~ *` don't work (selectors are relative to the item). An `item` selector that
matches nothing is a collection failure, not "no releases".

**`manual` files:** `products/<id>.releases.yaml` is a YAML list of `{ version: "1.2", date?, url?, notes? }`
(quote versions: YAML reads `1.10` as `1.1`); a manual `eol` file lists `{ name, releaseDate?, eolDate?, eol?, lts?,
codename? }`.

## Validation rules (CI)

`pnpm modules:validate` checks rules 1 and 4 plus: valid YAML without duplicate keys, every regex compiles,
no alias equals another module's id. Errors are printed as `file:line:col` (and as PR annotations in GitHub
Actions). `products/_template.yaml` (any file starting with `_`) is only checked against the schema.
Rules 2, 3 and 5 need collected data and run in the collector (`pnpm collect --only <id>`).

1. Schema-valid; `id` == file name.
2. `pnpm collect --only <id>` returns ≥ 1 release, every release version parses under `versionScheme`.
3. Tracks: every release matches at most one track.
4. If `security` has no entries, the module gets a `noSecuritySource` warning shown on its page ("security data not available").
5. HTML modules must include a recorded fixture of the page (bot records it in the PR) so selector breakage is detectable.

## Examples in this repo

`products/` contains working drafts for: debian, grafana, elasticsearch, kibana, logstash, poste-io, proxmox-ve,
routeros, percona-xtradb-cluster, zabbix, plus `_template.yaml`. **Endpoints, repo names and selectors in these
drafts must be verified in Sprint 1** — they are informed guesses, not tested.
