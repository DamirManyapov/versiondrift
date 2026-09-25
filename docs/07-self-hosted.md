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
      VD_AUTH: password            # none | password | oidc | header
      VD_ADMIN_PASSWORD: change-me-please # first run only (≥ 8 characters); stored as a scrypt hash
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
(branch and sha tags). The image runs with `VD_MODE=selfhosted` (boards in SQLite, sign-in, a local feed mirror).

Behind a reverse proxy that passes the original `Host` nothing needs configuring; if it rewrites `Host`, set
`ORIGIN=https://versiondrift.example.com`.

## Feed sync (S5-T4)

The server keeps a verified mirror of the public feed in `${VD_DATA_DIR}/feed/v1/` (`packages/feed`, `syncFeed`) and
serves it at `/feed/v1/…` (open without sign-in: it is public data), so browsers on the LAN only ever talk to the
instance. A sync, at start and on `VD_FEED_SYNC`:

1. fetches `index.json` (conditional on its ETag; unchanged → done) and `index.json.minisig`, and checks the
   signature against `VD_FEED_PUBKEY` — an unsigned or forged index is rejected;
2. downloads only the product files whose sha256 differs from what the signed index lists, and checks each one;
3. refreshes the unsigned display files (`catalog.json`, `health.json`, `versions.json`, the last 12 weekly digests);
4. moves everything into place with atomic renames, `index.json` last, and removes products that left the catalog.

Any failure keeps the previous mirror untouched and is logged and recorded in `feed/sync-state.json`
(`syncedAt`, `generatedAt`, `verified`, `lastError`). Until the first sync finishes (≈ 20 s) pages answer 503.
The first sync downloads ~15 MB; later ones only what changed.

Offline mode (`VD_OFFLINE`, running the collector inside the container instead of pulling the feed) is not
implemented yet: it needs the collector and the modules in the image and outbound access to every vendor.

## Auth (S5-T3)

`VD_AUTH` picks how people sign in; everything except `/login`, `/auth/*` and `/healthz` needs a signed-in user
(pages redirect to `/login?next=…`, the API answers 401). Users with role `viewer` can look but not change boards
(the API answers 403); everyone is `admin` for now.

- `password` (default): on first start the user `admin` is created with `VD_ADMIN_PASSWORD`, or with a random password
  printed once to the log (`docker logs`). Passwords are hashed with scrypt (N=2^15, r=8, p=1) from `node:crypto`;
  the draft said argon2id, which needs a native module or Node ≥ 24. At most 10 failed sign-ins per address and name
  in 15 minutes. "Account" in the header changes the password and signs out other devices.
- `oidc`: authorization code flow with PKCE, state and nonce (`oauth4webapi`), `VD_OIDC_ISSUER`, `VD_OIDC_CLIENT_ID`,
  optional `VD_OIDC_CLIENT_SECRET` (without it the client is public). Register the redirect URI
  `<ORIGIN or VD_BASE_URL>/auth/oidc/callback`. Users are created on first sign-in, keyed by issuer + subject. The ID
  token comes straight from the token endpoint over TLS, which OIDC Core allows in place of checking its signature.
- `header`: a reverse proxy (Authelia, Authentik outpost, oauth2-proxy) authenticates and sends the user name in
  `VD_TRUST_PROXY_HEADER` (default `Remote-User`). **Only use it when the instance is reachable through that proxy
  alone** — anyone who can reach the port directly can send the header themselves.
- `none`: no sign-in at all; for a trusted LAN or a proxy that authenticates without passing a name.

Sessions: a random 256-bit token in the `vd_session` cookie (HttpOnly, SameSite=Lax, 30 days; `Secure` when
`ORIGIN`/`VD_BASE_URL` is https or the proxy sends `X-Forwarded-Proto: https`), only its sha256 in the `sessions`
table. CSRF: a state-changing request whose `Origin` host differs from the request's host, or that the browser marks
`Sec-Fetch-Site: cross-site`, is refused with 403. SvelteKit's own origin check is off because adapter-node assumes
https without `ORIGIN`, which would refuse every form post on a plain-http LAN instance.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | listening port (adapter-node); `HOST` defaults to `0.0.0.0` |
| `VD_DATA_DIR` | /data | SQLite DB, cache, private modules |
| `VD_FEED_URL` | https://feed.versiondrift.dev/ | public feed (the directory holding `v1/`; a URL ending in `/v1/` works too) |
| `VD_FEED_PUBKEY` | baked-in | minisign public key (`keys/feed.pub`) |
| `VD_FEED_SYNC` | `0 3 * * *` | cron for the feed sync (the public feed is rebuilt at 02:00 UTC); also runs at start |
| `VD_TZ` | UTC | time zone for `VD_FEED_SYNC` |
| `PUBLIC_FEED_URL` | `/feed/` in the image | where browsers read the feed: the instance's own mirror |
| `VD_OFFLINE` | false | run own collector instead of pulling feed — **not implemented yet** |
| `VD_PRIVATE_MODULES_DIR` | /data/modules | extra modules (collected locally, merged into the view) |
| `VD_AUTH` | password | `none` (trusted LAN), `password`, `oidc`, `header` (a proxy authenticates; see Auth) |
| `VD_ADMIN_PASSWORD` | | first start in `password` mode: the `admin` user's password (≥ 8 characters); otherwise one is generated and printed to the log once |
| `ORIGIN` | | the public URL, e.g. `https://vd.example.com`; needed behind a proxy that rewrites `Host`, and for OIDC |
| `VD_OIDC_ISSUER`, `VD_OIDC_CLIENT_ID`, `VD_OIDC_CLIENT_SECRET` | | Authentik/Keycloak/etc. |
| `VD_TRUST_PROXY_HEADER` | | e.g. `Remote-User` for forward-auth setups |
| `VD_BASE_URL` | | for links in notifications |
| `VD_SECRET_KEY` | generated | encrypts stored credentials (notification channels; later detectors, integrations); without it a random key is kept in `/data/secret.key` — back it up with the database |

## SQLite schema (Drizzle)

Implemented so far (S5-T2, `packages/db`): `boards`, `instances` and `settings`; the rest of the draft below follows
with the features that need it. Differences from the draft: there is no `board_products` table — a board is its
ordered `instances` (`position`), and a product followed without a version is an instance with `version` null, so the
web app's inventory items map to rows one to one; `track` is per instance (prod on 8.x, legacy on 7.x). Settings
(critical CVSS threshold, "hide up to date") are instance-wide JSON values.

Migrations: change `packages/db/src/schema.ts`, run `pnpm -F @versiondrift/db generate` (drizzle-kit writes
`drizzle/NNNN_*.sql`, a script embeds them in `src/migrations.ts`, so they travel inside the bundled server code), and
commit both; CI fails when the schema and the migrations disagree. On start the server applies pending migrations in
transactions and records them in `vd_migrations`. The database is `${VD_DATA_DIR}/versiondrift.db` (WAL mode,
foreign keys on). `better-sqlite3` ships prebuilt binaries for every platform, including musl on amd64/arm64, so the
image needs no compiler.

With `VD_MODE=selfhosted` the web app reads and writes boards through a small JSON API (404 on the public site):
`GET/POST /api/boards`, `PATCH/DELETE /api/boards/:id`, `GET/PUT /api/boards/:id/inventory` (the browser's inventory
format). The board page gets a board switcher and "New board"; Settings can rename and delete boards (the last one
stays). Responses carry `X-Robots-Tag: noindex`.

Draft for the rest:

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

Implemented in S5-T5 (`packages/alerts`, shared with `pnpm notify`; `apps/web/src/lib/server/alerts.ts`):
Settings → Notifications lists channels — Telegram, ntfy, Gotify, webhook, e-mail (SMTP) — each with its own
subscriptions (vulnerabilities, end of life incl. 90 days before, new releases, weekly summary), message language and
summary weekday. After every feed sync (and on "Check now") each enabled channel gets what changed for every board's
products with a version since its own last delivery; a new channel first gets an overview, a failed delivery keeps
the channel's state so the next run reports the same changes again ("Last error" shows why). "Send test" checks the
settings without touching that state. Credentials are sealed in the database and never sent back to the browser
(an empty field on edit keeps the stored value). Webhooks receive
`{ source, title, text, html }` with `X-VersionDrift-Signature: sha256=<HMAC-SHA256 of the body with the secret>`.
Not implemented yet from the draft below: Slack/Matrix, per-board rules, quiet hours, a minimum CVSS per rule
(the instance-wide critical threshold applies).

Draft:

Triggered after each feed sync and detector run, by diffing product status per instance:
- `critical` — new affecting advisory, or instance became critical
- `eol` — branch became EOL, or EOL within 30 days
- `update` — optional, per product
- `weekly_digest` — Sunday 18:00 local, summary of the week for the board

Channels: Telegram bot (token + chat id), e-mail (SMTP), ntfy, Gotify, generic webhook (HMAC-signed JSON),
Slack/Matrix webhooks. Dedupe through `events`. Message templates in `apps/web/src/lib/notify/templates/`.

## Security

- No outbound calls except feed URL, configured detectors/integrations and notification endpoints.
- Credentials encrypted at rest with AES-256-GCM (`node:crypto`), keyed by `VD_SECRET_KEY` or `/data/secret.key`.
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
