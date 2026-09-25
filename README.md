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

Self-hosted adds automatic version detection inside your network (HTTP endpoints, SSH, Docker, SNMP, Zabbix, Proxmox, Ansible)
and alerts via Telegram, e-mail, ntfy, Gotify or webhooks.

## Status

Pre-alpha. See [`docs/09-roadmap.md`](docs/09-roadmap.md).

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

Code: AGPL-3.0 (see `docs/adr/0005-license.md`). Modules and feed data: CC BY 4.0.
