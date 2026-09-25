# 11 — Name, launch & growth

## Name

Working name **VersionDrift** — "version drift" is the established ops term for exactly this problem
(the gap between what you run and what upstream ships), so the name explains itself and matches search intent.

Domain check done on 2026-09-25 via registry RDAP (a 404 means "not registered at that moment"; confirm at a registrar):

| Name | .dev | Other | Notes |
|---|---|---|---|
| **VersionDrift** | `versiondrift.dev` free | `versiondrift.io` free | recommended; generic term, check trademark; a small unrelated GitHub repo `version-drift` exists |
| Verscope | `verscope.dev` free | | short, brandable, less self-explanatory |
| Patchsight | `patchsight.dev` free | | sounds security-focused |
| PatchLag | `patchlag.dev` free | | playful, explicit |
| Upstream Radar | `upstreamradar.dev` free | | long |
| Stack Radar (prototype name) | `stackradar.dev` **taken** | | |
| Driftboard | | taken (kanban product) | avoid |
| StackDrift | `stackdrift.dev` free, `.app` taken | | clashes with AWS "stack drift" (CloudFormation) |

Recommendation: register `versiondrift.dev` (+ `.io` as redirect) at Cloudflare Registrar, GitHub org `versiondrift`,
`@versiondrift` handles on X/Mastodon/Telegram, Docker/GHCR namespace — all on the same day.

## Pre-launch checklist (end of S4)

- [ ] 60+ modules, all green in `/status`
- [ ] demo board on first visit, light + dark theme, mobile layout OK
- [ ] compare pages indexed (Search Console + Bing Webmaster), sitemap submitted
- [ ] README with GIF of the board; `docs/` published
- [ ] privacy page ("your versions never leave your browser") and data-sources/credits page
- [ ] feedback channel: GitHub Discussions + Telegram chat

## Launch channels (in order)

1. **Habr** (ru): article "Я перестал следить за релизами 30 продуктов — и сделал доску" with the author's real case.
2. **r/selfhosted**, **r/homelab**, **r/sysadmin** (self-hosted image ready first for r/selfhosted — S5).
3. **Hacker News** "Show HN: VersionDrift – see how far your stack has drifted from upstream".
4. **awesome-selfhosted** PR (requires self-hosted release + license), **selfh.st** newsletter, **Console.dev** newsletter.
5. Telegram channels for DevOps (ru), DevOps Weekly / SRE Weekly newsletters.
6. Product Hunt — optional, low priority for this audience.

## Ongoing growth loops

- **SEO**: compare/version pages for every popular product (long-tail "X to Y breaking changes", "is X vulnerable").
- **Modules as contributions**: each new module brings its contributor and their community. Label
  `good first module`, monthly "modules added" changelog post.
- **Embeds**: status badge `![](https://versiondrift.dev/badge/grafana/11.3.1.svg)`; widgets for Homepage/Homarr dashboards.
- **Weekly public digest**: "This week in self-hosted releases" (auto-generated from `week/*.json`, edited by a human),
  posted to Telegram/RSS/newsletter — builds audience with no product usage required.

## Initial module priority list (S1–S4)

OS: debian, ubuntu, rocky-linux, alma-linux, alpine, rhel (lifecycle), windows-server (lifecycle)
Virtualization: proxmox-ve, proxmox-backup-server, xcp-ng, vmware-esxi (lifecycle)
Containers: docker-engine, containerd, kubernetes, k3s, microk8s, helm, portainer, traefik
Monitoring: grafana, prometheus, zabbix, alertmanager, loki, uptime-kuma, netdata, victoriametrics
Logging: elasticsearch, kibana, logstash, opensearch, graylog, fluent-bit
Databases: postgresql, mysql, mariadb, percona-server, percona-xtradb-cluster, mongodb, redis, valkey, clickhouse
Mail: poste-io, mailcow, mailu, postfix, dovecot, roundcube, stalwart
Network: routeros, opnsense, pfsense, wireguard, nginx, haproxy, caddy, openvpn
Storage/backup: minio, truenas, restic, borg, nextcloud, seafile
Collab/other: outline, gitlab, gitea, forgejo, onlyoffice, bigbluebutton, keycloak, authentik, vaultwarden,
rabbitmq, home-assistant, jellyfin, immich, 1c-enterprise (lifecycle, ru audience)
