# VersionDrift

**See how far your stack has drifted from upstream.**

Tell VersionDrift which products you run and which versions you have. It shows, in one board:

- 🟥 which products have security fixes you are missing (with CVSS and CVE ids),
- ⬛ which of your release branches are end-of-life,
- 🟧 what changed since your version — breaking changes and deprecations highlighted,
- 🟩 what is already up to date,
- and a weekly "what shipped" feed for everything you care about.

Products are simple YAML modules — if yours is missing, add a file and open a PR.

## Ways to use it

| | Where your data lives | Setup |
|---|---|---|
| **versiondrift.dev** (no account) | your browser only | none |
| **versiondrift.dev** (account) | product + version only, for sync & alerts | sign in |
| **Self-hosted** (Docker) | your server | `docker compose up -d` |

Self-hosted keeps several boards on your server, signs people in (password, OIDC or your proxy), serves a verified copy
of the feed to your network and sends alerts via Telegram, e-mail, ntfy, Gotify or webhooks. Automatic version detection
inside your network (HTTP endpoints, Docker, SSH, SNMP, Zabbix, Proxmox) is next.

## Status

Pre-alpha. See [`docs/09-roadmap.md`](docs/09-roadmap.md).

- **versiondrift.dev**: 72 products collected daily into a signed feed; a board in your browser, share links,
  comparison and "is this version affected?" pages, RSS.
- **Self-hosted** (no published image yet): `Dockerfile` and `charts/versiondrift`; setup in
  [`docs/07-self-hosted.md`](docs/07-self-hosted.md).
- **Telegram alerts without a server**: `pnpm notify` from a GitHub Action or cron (same doc).

## Add a product

```yaml
# products/grafana.yaml
id: grafana
name: Grafana
category: monitoring
versionScheme: semver
sources:
  releases: { type: github, repo: grafana/grafana }
  security: [{ type: ghsa, repo: grafana/grafana }]
  eol: { type: endoflife, product: grafana }
```

Guide: [`docs/10-contributing-modules.md`](docs/10-contributing-modules.md).

## Data sources & credits

Release data from vendors' own release pages and repositories; lifecycle data from
[endoflife.date](https://endoflife.date); vulnerabilities from OSV, GitHub Security Advisories, NVD,
the Debian Security Tracker and the CISA KEV catalog. Every item links back to its source.

## License

Code: [AGPL-3.0-only](LICENSE); code contributions need a [CLA](CLA.md). Product modules (`products/`) and the feed data:
[CC BY 4.0](LICENSES/CC-BY-4.0.txt). Why: [`docs/adr/0005-license.md`](docs/adr/0005-license.md).
