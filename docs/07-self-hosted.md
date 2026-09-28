# 07 — Self-hosted

One multi-arch image `ghcr.io/<org>/versiondrift:<version>` (amd64, arm64). SvelteKit `adapter-node` + SQLite +
background scheduler. Same UI as the public site, `VD_MODE=selfhosted`.

## Quick start

`git clone` the repository and run `docker compose up -d`: `compose.yaml` builds the image from the source (until a
release tag publishes `ghcr.io/damirmanyapov/versiondrift`), keeps the data in the `vd-data` volume and serves
http://localhost:8080. The published image will be used the same way:

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

## Deploying (S5-T6)

```yaml
# docker-compose.yml
services:
  versiondrift:
    image: ghcr.io/<owner>/versiondrift:latest
    restart: unless-stopped
    read_only: true
    tmpfs: [/tmp]
    ports: ["127.0.0.1:8080:8080"] # behind a reverse proxy; "8080:8080" to reach it directly on the LAN
    volumes: ["./data:/data"]
    environment:
      VD_ADMIN_PASSWORD: change-me-please # first start only
      VD_TZ: Europe/Moscow                # for the feed sync schedule
      ORIGIN: https://vd.example.com      # the public URL, if a proxy rewrites Host (and for OIDC)
```

First start: the `admin` password is `VD_ADMIN_PASSWORD`, or a random one printed by `docker compose logs`. The feed
mirror is ready after ~20 seconds. `./data` must be writable by uid 1000 (`chown 1000 ./data`).

**Reverse proxy.** Anything that passes the original `Host` works without settings:

```
# Caddy (TLS included; sends X-Forwarded-Proto, so the session cookie is Secure)
vd.example.com {
  reverse_proxy versiondrift:8080
}
```

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

```yaml
# Traefik labels
labels:
  - traefik.http.routers.vd.rule=Host(`vd.example.com`)
  - traefik.http.services.vd.loadbalancer.server.port=8080
```

**Single sign-on.** Either OIDC (`VD_AUTH=oidc`, `VD_OIDC_ISSUER=https://auth.example.com/application/o/versiondrift/`,
`VD_OIDC_CLIENT_ID`, `VD_OIDC_CLIENT_SECRET`, redirect URI `https://vd.example.com/auth/oidc/callback`), or a
forward-auth proxy (Authelia, authentik outpost, oauth2-proxy) with `VD_AUTH=header` and the header it sets
(`VD_TRUST_PROXY_HEADER=Remote-User`); then publish the port only to the proxy.

**GitOps inventory.** A `/data/inventory.yaml` (or `VD_INVENTORY_FILE`) in the `pnpm notify` format is imported at
start and whenever its content changes (file watch plus a one-minute poll): the boards it names are created or
replaced, other boards stay. UI edits to those boards last until the file changes again; a file that doesn't
validate is logged and ignored.

```yaml
boards:
  prod:
    products:
      grafana: [{ version: "12.1.1", host: mon-01 }, { version: "11.6.4", host: mon-02 }]
      poste-io: "2.5.17"
```

**Kubernetes.** `charts/versiondrift` (S6-T5): one replica with the `Recreate` strategy (SQLite on a volume), a PVC
for `/data`, a Secret for `auth.adminPassword`, `secretKey` and the OIDC client secret (or `existingSecret`), an
optional Ingress, and `inventory` as a ConfigMap mounted read-only and imported like `/data/inventory.yaml`. The pod
runs as uid 1000 with a read-only root file system and `/healthz` probes.

```bash
helm install vd ./charts/versiondrift --set origin=https://vd.example.com --set auth.adminPassword=change-me-please \
  --set ingress.enabled=true --set 'ingress.hosts[0].host=vd.example.com'
```

**Backups and upgrades.** Back up `./data/versiondrift.db` (plus `-wal`/`-shm` if the container runs; or stop it)
and `./data/secret.key` — without the key, notification credentials must be entered again. `./data/feed` is
re-synced on start. Upgrading is `docker compose pull && docker compose up -d`; database migrations run on start.

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
| `VD_SECRET_KEY` | generated | encrypts stored credentials (notification channels, access profiles; later integrations); without it a random key is kept in `/data/secret.key` — back it up with the database |
| `VD_DETECT_INTERVAL` | 6 | hours between fleet polls (cron at the top of the hour, in `VD_TZ`) |
| `VD_DEMO` | | `1`: an instance without hosts starts with the demo fleet (31 hosts on two sites, `fixtures/fleet-demo.json`); for trying the fleet screens, never for production |

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
format). The board page gets a board switcher with "Rename", "Delete board" (asks once more, inline) and "New board";
Settings lists all boards with the same actions. The last board stays, and the switcher says so when asked to delete it. Responses carry `X-Robots-Tag: noindex`.

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

## Version detection (Sprint 6, ADR-0007)

The instance reads versions itself, from inside the customer's network: agentless polling over SSH, vendor APIs and
SNMP, with read-only credentials shared by many hosts. Nothing about hosts leaves the instance.

**Model**

| Entity | Fields | Notes |
|---|---|---|
| Site | name | free grouping of hosts ("Moscow DC", "Branch 2"); filters every view |
| Access profile | name, kind (`ssh-linux`, `windows`, `routeros`, `proxmox`: the detector it serves), user, secret (sealed) | one profile for many hosts; the secret is write-only in the UI |
| Host | name, address, port?, site, access profile, detectors, last poll, last error | added by hand or from a CSV (`name,address,site,profile`) |
| Instance | product, version, track, host?, source (`detector` / `manual` / `import`) | detected instances update on every poll; manual ones stay as typed |
| Poll | host, time, result (`ok` / `unreachable` / `auth-failed` / `unknown`), changes | history: "srv-03: Debian 12.11 → 12.12" |

**Detectors v1**

| Detector | Reads | Least privilege |
|---|---|---|
| `ssh-linux` | `/etc/os-release`, `/etc/debian_version`, `dpkg-query -W` (or `rpm -qa`) → OS point release and packages mapped to products (`postgresql-16`, `nginx`, `docker-ce`, …) | a dedicated user without sudo; key restricted in `authorized_keys` (`restrict,command="/usr/local/bin/versiondrift-inventory"`) |
| `routeros` | SSH: `/system resource print`, `/system routerboard print` → RouterOS and firmware (RouterOS 6 and 7 alike) | a user in a group with only the `read` and `ssh` policies, login allowed only from the instance's address |
| `windows` | SSH to the built-in OpenSSH server (Server 2019+; 2016 needs the OpenSSH package): `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` `CurrentBuild` + `UBR` → `20348.5622` | a standard local or domain user, not an administrator |
| `proxmox` | API token: `/version`, `/nodes/{node}/apt/versions` → PVE / PBS per node | token with role `PVEAuditor` (PBS: `Audit`), privilege separation on |
| `http` (module rules) | unauthenticated version endpoints: Grafana `/api/health`, Elasticsearch `/`, … | none, or an API key with a monitoring-only role |

Next: vSphere `about` (ESXi/vCenter version and build, no login needed), `sql` (`SELECT version()` with a user without
grants), Docker through a read-only socket proxy, SNMP v3 read-only.

**Instructions live with the detector.** A module's `detect` rule carries a short setup text for its least-privilege
account (commands to copy). The UI shows it when an access profile of that kind is created; the docs site renders
the same text per product.

**Screens** (S6-T5, design in `docs/specs/fleet-ui.md`): with hosts, the header gets *Board · Hosts · This week ·
Access profiles* and a site switcher (`?site=<id>`, remembered per browser). The board aggregates each product over
the hosts of the chosen site (tiles with a status bar and per-line ranges, a panel with the hosts per version);
`/hosts` lists hosts with filters (status, poll problems, type), search and grouping by site; `/hosts/:id` explains a
poll problem and shows the products and history; `/access-profiles` lists profiles and which hosts fail. The data
comes from `GET /api/fleet` (sites, profiles without secrets, hosts with poll state and products) and
`GET /api/hosts/:id` (history); statuses are computed in the browser by `packages/core` (`fleet.ts`). "Poll now" (host
card, or the selected rows of the hosts table) posts `POST /api/hosts/poll {ids}` and follows
`GET /api/poll/jobs/:id` once a second; the poller runs 8 hosts at a time. «Добавить хосты» (header, `?add=one|csv`)
adds one host (`POST /api/hosts`) or a CSV list: `POST /api/hosts/import?dryRun=1` answers per line (new, already
there, will change, error with the reason), `POST /api/hosts/import` writes it (an upsert by name; new sites are
created) and polls what it added. Access profiles are made with a wizard (`/access-profiles/new`: type → how to create the
account, commands to copy → details, save, test on a host); `POST /api/access-profiles` (Linux profiles get an
ed25519 key pair from the instance: the private key sealed, the public key shown as an authorized_keys line with the
forced command), `PATCH /api/access-profiles/:id {secret}`, `DELETE`, and `POST /api/access-profiles/:id/test
{hostId}` (runs the detector, stores nothing). The Linux inventory script is `apps/web/static/downloads/versiondrift-inventory`. Detectors live in `packages/detect`: Linux runs
`versiondrift-inventory` (the forced command) and maps OS release and packages to products, Windows runs
`cmd /c ver`, RouterOS `/system resource print` (the update channel becomes the track), all over SSH; Proxmox reads
`/api2/json/version` with the token (VE on 8006, Backup Server on 8007 when the token user is `…@pbs!…`). The SSH host
key and the Proxmox TLS certificate are pinned on the first successful contact (`hosts.host_key`,
`hosts.tls_fingerprint`); a change is refused (`host_key_mismatch`, `tls_mismatch`) until an admin trusts the new one
from the host card (`POST /api/hosts/:id/reset-pins`). With `VD_DEMO=1` a demo detector answers from the stored data
instead (hosts with a poll problem keep failing).

**Polling**: every 6 hours by default (`VD_DETECT_INTERVAL`), and "Poll now" per host, site or profile. Timeouts and
concurrency are bounded (default 8 hosts at a time). A failed poll keeps the last detected versions and marks the
host (`unreachable`, `auth-failed`) instead of clearing them.

**Where the poller runs**: inside the web container by default. For segmented networks the same image runs as a
second compose service (`command: detector`) in the server segment; it shares the SQLite volume.

**Integrations** (later, ADR-0007): Zabbix and vCenter as *host list* imports (names, addresses, groups → sites);
Ansible facts import; NetBox. Stock Zabbix templates report the OS family, not the patch level, so they do not
replace the detectors.

```yaml
# /data/inventory.yaml (import / GitOps). sites/hosts come with S6; profiles by name, secrets never in this file
sites: [Moscow DC, Branch 2]
hosts:
  - { name: srv-app-01, address: 10.0.1.11, site: Moscow DC, profile: ssh-linux-ro }
  - { name: gw-branch2, address: 10.2.0.1, site: Branch 2, profile: mikrotik-ro }
boards:
  prod:
    products:
      percona-xtradb-cluster: [{ version: 5.7.44, label: legacy-cluster }]   # manual, no detector
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
