# 07 — Self-hosted

One multi-arch image `ghcr.io/<org>/versiondrift:<version>` (amd64, arm64). SvelteKit `adapter-node` + SQLite +
background scheduler. Same UI as the public site, `VD_MODE=selfhosted`.

## Quick start

```yaml
# docker-compose.yml
services:
  versiondrift:
    image: ghcr.io/<org>/versiondrift:latest
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      VD_AUTH: password            # none | password | oidc
      VD_ADMIN_PASSWORD: change-me # first run only; stored as argon2id hash
      VD_TZ: Asia/Bangkok
    restart: unless-stopped
```

Distribution targets: Docker Compose, Helm chart (`charts/versiondrift`), Proxmox VE community helper script (LXC),
Unraid/TrueNAS templates, a static binary is **not** planned.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `VD_PORT` | 8080 | |
| `VD_DATA_DIR` | /data | SQLite DB, cache, private modules |
| `VD_FEED_URL` | https://feed.versiondrift.dev/v1/ | public feed |
| `VD_FEED_PUBKEY` | baked-in | minisign public key |
| `VD_FEED_SYNC` | `0 3 * * *` | cron |
| `VD_OFFLINE` | false | run own collector instead of pulling feed |
| `VD_PRIVATE_MODULES_DIR` | /data/modules | extra modules (collected locally, merged into the view) |
| `VD_AUTH` | password | `none` (trusted LAN / behind proxy auth), `password`, `oidc` |
| `VD_OIDC_ISSUER`, `VD_OIDC_CLIENT_ID`, `VD_OIDC_CLIENT_SECRET` | | Authentik/Keycloak/etc. |
| `VD_TRUST_PROXY_HEADER` | | e.g. `Remote-User` for forward-auth setups |
| `VD_BASE_URL` | | for links in notifications |
| `VD_SECRET_KEY` | generated | encrypts stored credentials (detector/integration secrets) |

## SQLite schema (Drizzle)

```
users(id, email, name, role[admin|viewer], password_hash?, oidc_sub?, created_at)
boards(id, name, owner_id, created_at)                       -- multiple boards (e.g. "Prod", "Homelab")
board_products(board_id, product_id, track?, position)
instances(id, product_id, board_id, version, label?, host?, source[manual|detector|import|integration],
          detector_id?, detected_at?, created_at, updated_at)
detectors(id, product_id?, kind, config_json_encrypted, schedule, last_run_at, last_result)
integrations(id, kind[zabbix|proxmox|ansible|netbox], config_json_encrypted, schedule, last_run_at, last_result)
notification_channels(id, kind[telegram|email|ntfy|gotify|webhook|slack|matrix], config_json_encrypted, enabled)
notification_rules(id, board_id, on[critical|eol|update|weekly_digest], channel_id, min_cvss?, quiet_hours?)
events(id, board_id, product_id, instance_id?, kind, payload_json, created_at, notified_at?)   -- dedupe alerts
feed_state(key, etag, fetched_at, verified)
```

## Version detection (Sprint 6)

Module `detect` rules, run by `apps/detector`:

| Kind | Config | Notes |
|---|---|---|
| `http` | url (or host+`defaultPort`+path), `jsonPath` or `regex`, headers, TLS verify | Grafana `/api/health`, Elasticsearch `/`, Kibana `/api/status` |
| `command` | `run`, `regex` | executed over SSH (below), never locally unless `local: true` |
| `ssh` | host, user, key (encrypted), then any `command` rule | key-based only |
| `docker` | image name → tag of running container | via Docker socket (read-only mount) or remote API |
| `snmp` | oid, community/v3 creds | MikroTik RouterOS, network gear |
| `sql` | DSN, query | `SELECT VERSION()` for MySQL/Percona/PostgreSQL |
| `file` | path (over SSH) | `/etc/debian_version` |
| `dpkg` | over SSH | installed Debian packages → feeds Debian security matching |

**Integrations** — preferred at scale (no per-host credentials in VersionDrift):
- **Zabbix**: API token → items with keys like `agent.version`, `system.sw.os`, templates' version items, host inventory
  fields (`software`, `os`). Map by rules (`item key → product`).
- **Proxmox VE**: API token → `GET /version` per node; also enumerate VMs/CTs (names/tags) for labels.
- **Ansible**: import `ansible -m setup` facts JSON / a facts cache directory → OS + package versions.
- **NetBox** (later): custom fields → instances.
- **Inventory file**: `inventory.yaml` in `/data` watched for changes (GitOps-friendly).

```yaml
# /data/inventory.yaml
boards:
  prod:
    products:
      grafana:        [{ version: 11.3.1, host: mon-01 }, { version: 12.1.1, host: mon-02 }]
      poste-io:       [{ version: 2.4.5, host: mail-01 }]
      percona-xtradb-cluster: [{ version: 5.7.44, label: legacy-cluster }]
```

## Notifications

Triggered after each feed sync and detector run, by diffing product status per instance:
- `critical` — new affecting advisory, or instance became critical
- `eol` — branch became EOL, or EOL within 30 days
- `update` — optional, per product
- `weekly_digest` — Sunday 18:00 local, summary of the week for the board

Channels: Telegram bot (token + chat id), e-mail (SMTP), ntfy, Gotify, generic webhook (HMAC-signed JSON),
Slack/Matrix webhooks. Dedupe through `events`. Message templates in `apps/web/src/lib/notify/templates/`.

## Security

- No outbound calls except feed URL, configured detectors/integrations and notification endpoints.
- Credentials encrypted at rest with `VD_SECRET_KEY` (libsodium secretbox).
- CSRF protection, secure cookies, rate-limited login, audit log of settings changes.
- Container runs as non-root, read-only root FS except `/data`.
