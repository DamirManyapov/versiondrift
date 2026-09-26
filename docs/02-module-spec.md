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
| `tracks` | | needed when a product has parallel supported lines (ES 8/9, Debian 12/13, PostgreSQL majors). Ids are strings — quote numbers (`id: "12"`), unique, `latest` is reserved. Each has `match` (a version regex) **or** `current: { url, versionRegex? }` — an update channel's "newest version" URL; the track is that version's major.minor branch, re-read every run. `prereleases: true` lets release candidates count (a testing channel). `group` puts tracks into a product line ("RouterOS 7"): users then pick the line, then the channel within it. Tracks may overlap; the first matching one is what a version is assumed to follow (docs/05) |
| `defaultTrack` | | `latest` (default) or one of the track ids |
| `releaseNotesUrl` | | per-release notes page with a `{version}` placeholder (`https://www.zabbix.com/rn/rn{version}`); used as the release link |
| `classify` | | hints; without them the generic pipeline is used |
| `detect` | | list, first match wins |
| `maintainers` | | GitHub handles |

## Source types

| `type` | For | Config | Gives |
|---|---|---|---|
| `github` | GitHub releases (falls back to tags if `useTags: true`) | `repo`, `useTags?`, `notesFrom?: release\|changelogFile`, `changelogPath?`, `versionRegex?` (version from the tag name, e.g. `'^release-(\d+\.\d+\.\d+)$'`; other tags are ignored) | releases + notes |
| `gitlab` | GitLab releases | `host?` (default gitlab.com), `project` | releases + notes |
| `gitea` | Gitea/Forgejo/Codeberg | `host` (`codeberg.org`), `repo`, `versionRegex?` | releases + notes |
| `rss` | RSS/Atom feeds | `url`, `versionFrom: title\|link`, `versionRegex` | releases (+ notes from entry body) |
| `html` | changelog pages without a feed | `url`, `select: { item, title, body, date? }`, `versionRegex`, `dateFormat?` | releases + notes |
| `dockerhub` | image tags | `repo` (`analogic/poste.io`), `tagRegex?`, `versionRegex?` | versions + push dates (no notes) |
| `endoflife` | lifecycle, or releases | `product` (endoflife.date slug) | branches, EOL dates, LTS flags; as `releases`: the latest release of every cycle (OS and appliances without usable notes; history grows run by run) |
| `osv` | OSV.dev advisories | `ecosystem`, `package` | advisories with affected ranges |
| `ghsa` | GitHub Security Advisories | either `repo` (repository advisories) or `ecosystem`+`package` | advisories with ranges |
| `nvd` | NVD CVE API 2.0 | `cpe` | CVEs + CVSS + CPE ranges |
| `debian` | Debian Security Tracker | `packages: [..] \| fromInventory` | DSA/DLA per release |
| `kev` | CISA KEV catalog (global, not per module) | — | "known exploited" flag by CVE id |
| `manual` | products with no machine-readable source | `file: products/<id>.releases.yaml` | releases maintained by hand |
| `pointer` | an update server's "newest version" file | `url`, `versionRegex?`, `epoch?` (a Unix time after the version dates the release) | the current version, one a day |
| `notes` | releasesExtra only: notes per version | `url` with `{version}`, `format?` (`text` default) | notes (and the first line's date) for releases being classified |
| `apt` | versions of a package in an APT repository | `url` (the `Packages` index), `package`, `versionRegex?` (e.g. drop the Debian revision `-1`) | versions (no dates or notes) |
| `debian-changelog` | a package's `debian/changelog` | `url`, `versionRegex?` | notes (Markdown bullets) and the signature line's date per version |
| `changelog` | a changelog file in a vendor's own layout | `url`, `dialect` (`zabbix`) | notes per version (Zabbix: one ChangeLog per release branch; a final release "released without any changes" gets its rc's notes) |

`sources.releases` may be a list: each source adds the versions it knows, the first to name a version wins and later
ones fill in missing notes, dates and links (RouterOS: stable RSS + the long-term history page + channel pointers +
endoflife.date's branch heads). The run fails only if none answers. `notes` fetches at most 200 files a run, only for
releases being classified (new ones, or all after a module change).

New source types = new adapter in `packages/adapters` + fixtures + docs row here. `gitlab` is specified but not
implemented yet (a module using it fails collection with "not implemented"; gitlab.com's API needs a token even for
public projects, so GitLab itself is collected from the `gitlabhq/gitlabhq` GitHub mirror).

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

`products/` holds 72 modules. The first 17 were verified against their live sources in S1-T7 and cover every
source type in use: GitHub releases (grafana, elastic stack, nginx with `versionRegex`, minio with `versionScheme: regex`,
rabbitmq, outline, bigbluebutton), GitHub tags (zabbix, percona-xtradb-cluster), RSS (debian, routeros, postgresql),
HTML (poste-io, proxmox-ve and proxmox-backup-server from their roadmap wikis, elastic release-notes pages as an extra
source), Docker Hub (poste-io extra) and endoflife.date. S4-T5 added 55 more from the launch list in
`docs/11-launch-and-growth.md`: mostly GitHub releases or tags with `versionRegex` (mysql, mariadb, mongodb,
percona-server, authentik, clickhouse), and endoflife.date as the release source for distributions and appliances
(ubuntu, rhel, rocky-linux, almalinux, alpine-linux, xcp-ng, truenas, haproxy, postfix); Forgejo comes from Codeberg
(`type: gitea`). Copy `_template.yaml` for new ones.

Proxmox VE and Backup Server take their versions from the APT repositories (the `pve-manager` /
`proxmox-backup-server` package, which is what the web UI and `pveversion` show: 9.2.20, not the ISO's 9.2), with notes
and dates from the packages' `debian/changelog`; the roadmap wiki still adds the X.Y release highlights.

RouterOS models MikroTik's update channels as tracks grouped by line: RouterOS 7 (long-term by pointer, stable, testing
with release candidates) and RouterOS 6 (long-term by pointer, stable); the development channel's betas are filtered
out. Stable releases below each branch's head (7.24.0–7.24.3) are
not listed anywhere machine-readable, so they appear as they ship.

Known gaps: debian and postgresql feeds list only recent releases, so their history grows day by day;
percona tags carry no notes. Zabbix takes its notes from the ChangeLog of each supported release branch (7.4, 7.0, 6.0);
a new LTS branch needs its line added to the module.
Products taken from tags (mysql, mariadb, mongodb, dovecot, gitlab via the `gitlabhq/gitlabhq` mirror, …) have no notes
either; endoflife.date release sources only know the latest release of each cycle. Windows Server and VMware ESXi were
left out on purpose: their version strings (build numbers, "8.0 Update 3k") don't identify the patch level reliably.
pfSense (its public repo stopped at 2.5.2), WireGuard (the tools barely change; the module is in the kernel) and 1C:Enterprise
(no public release feed) from the priority list have no usable source yet. Operating systems collected from
endoflife.date have no security source: NVD's OS-level CPEs would mark every supported release as affected.
