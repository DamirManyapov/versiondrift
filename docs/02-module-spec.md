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
| `branchGroups` | | `versionScheme: regex` only: how many leading capture groups form the branch |
| `sources.releases` | ✓ | exactly one primary source |
| `tagFilter` | | regexes applied to raw version strings before parsing |
| `tracks` | | needed when a product has parallel supported lines (ES 8/9, Debian 12/13, PostgreSQL majors). Ids are strings — quote numbers (`id: "12"`), unique, `latest` is reserved |
| `defaultTrack` | | `latest` (default) or one of the track ids |
| `classify` | | hints; without them the generic pipeline is used |
| `detect` | | list, first match wins |
| `maintainers` | | GitHub handles |

## Source types

| `type` | For | Config | Gives |
|---|---|---|---|
| `github` | GitHub releases (falls back to tags if `useTags: true`) | `repo`, `useTags?`, `notesFrom?: release\|changelogFile`, `changelogPath?` | releases + notes |
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

New source types = new adapter in `packages/adapters` + fixtures + docs row here.

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
