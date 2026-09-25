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

## Image (S5-T1)

`Dockerfile` at the repository root: a build stage (runs once on the build machine's platform — the output is plain
JavaScript) installs the workspace with pnpm, builds `apps/web` with `adapter-node` and `pnpm deploy`s its production
dependencies; the runtime stage is `node:22-alpine` with only `build/` and those dependencies, running as `node`
(uid 1000) with `/data` as the only writable path (`docker run --read-only` works), `HEALTHCHECK` on `/healthz`.
CI builds the image and starts it on every push; `.github/workflows/release.yml` publishes
`ghcr.io/<owner>/versiondrift` for `linux/amd64` and `linux/arm64` on a `v*` tag (`1.2.3`, `1.2`, `latest`) or by hand
(branch and sha tags). Until S5-T2…T4 land, the image is the public site's UI reading the public feed from the browser.

Behind a reverse proxy set `ORIGIN=https://versiondrift.example.com` (adapter-node needs it to accept form posts), or
`PROTOCOL_HEADER=x-forwarded-proto` + `HOST_HEADER=x-forwarded-host`.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | listening port (adapter-node); `HOST` defaults to `0.0.0.0` |
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

## Telegram alerts (S2-T9, before self-hosted)

`apps/notify` sends Telegram messages about *your* stack from the public feed — no server needed. It reads an
`inventory.yaml` (the format above; a product may also be just a version string, `poste-io: "2.5.17"`; quote versions),
verifies the feed (minisign signature of `index.json`, sha256 of every product file), computes statuses with
`packages/core` and messages only what changed since the last run:

- 🟥 a new advisory affects an instance (`critical`, from S3 on),
- ⬛ a branch reached end of life, or will within 90 days (once),
- 🟧 a new release while the instance is behind (once per new latest release),
- a version in the inventory is not recognised.

The first run sends one summary; a weekly summary (default Monday, `--digest`) lists what needs attention and what
shipped. What was sent is remembered in a state file.

```bash
TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=… pnpm notify test                      # check the bot can write to the chat
pnpm notify run --inventory inventory.yaml --dry-run --lang ru                 # print instead of sending
pnpm notify run --inventory inventory.yaml --state notify-state.json --lang ru # e.g. from cron on any server
```

In this repository, `.github/workflows/notify.yml` runs after every feed update when the secrets `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID` and `NOTIFY_INVENTORY` (the YAML itself) are set, with the state in the private bucket
(`r2:notify/state.json`) and the language from the repository variable `NOTIFY_LANG`. The inventory never enters the
repository. Setup: create a bot with @BotFather, send it a message, read your chat id from
`https://api.telegram.org/bot<token>/getUpdates`, set the three secrets. In S5 this becomes the Telegram channel of the
self-hosted notifications.
