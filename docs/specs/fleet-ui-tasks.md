# Fleet UI — task breakdown

Spec: `docs/specs/fleet-ui.md`. Reference: `design/fleet/prototype/`. Test data: `fixtures/fleet-demo.json`.
Order matters: each task leaves the app working. Mark tasks ✅ when done.

| # | Task | Done when |
|---|---|---|
| FL-1 ✅ | **Audit & plan.** Map spec entities/endpoints to what already exists (hosts, polling, detectors, profiles). Write the gap list and the plan into this file. | Plan reviewed by the owner; no code yet |
| FL-2 | **Demo seed.** Loader for `fixtures/fleet-demo.json` behind `VD_DEMO=1` (sites, profiles, hosts, instances, poll states, history). | Dev instance starts with 31 hosts |
| FL-3 | **Status model** in `packages/core`: `hostStatus()`, `productAggregate()`, per-line latest, stale rule, pending, unknown, manual source. Unit tests use `expected` from the fixture. | Tests reproduce every number in spec §5.A and the host chips of kzn-fs-01 / kzn-gw-02 |
| FL-4 | **API** gaps from spec §6 (list/filter hosts, host detail, sites summary, bulk patch/delete, poll job + progress, CSV dry-run/import, profile test). Secrets write-only. | API tests green; CSV dry-run returns line-level errors |
| FL-5 | **Tokens & primitives**: status chip (solid/dashed), distribution bar, host chip, filter chip group, toast, confirm dialog, code block with copy. Dark + light. | Storybook/demo page or visual test for each |
| FL-6 | **Header**: tabs, site switcher + popover (F), poll schedule, «Добавить хосты». Site filter in URL. | Switching site updates every screen |
| FL-7 | **Board (A)**: aggregated tiles, summary strip + «Проблемы опроса», detail panel with version breakdown, changes expand, copy hosts. | e2e: demo numbers match spec §5.A |
| FL-8 | **Hosts table (B)**: filters with counts, search, grouping, severity sort, selection rules, bulk bar + dialogs (typed confirm >10). Virtualize if >200 rows. | e2e: select-all selects only filtered rows; delete 31 requires typing 31 |
| FL-9 | **Host card (C)**: header, poll now, error block with actions, products table, manual product, history. | kzn-fs-01 stays red with «Отказ в доступе»; kzn-gw-02 shows «Нет связи» |
| FL-10 | **Add hosts (D)**: single form with connection check; CSV dropzone → dry-run preview → import → check progress → summary. | Importing the demo CSV into an empty instance yields 29/1/1 |
| FL-11 | **Access profiles (E)**: list, detail (replace secret, host vs profile failure), 3-step wizard with per-type instructions from modules, generated SSH key, test on host. | Wizard works for all 5 types |
| FL-12 | **First run (G)**: `/setup` flow; live-filling board during first poll; result banner. | Fresh instance → board fills progressively |
| FL-13 | **States**: unknown version, manual entry conflicts, empty states, 300-host performance. | Each state in `States.dc.html` reproducible via seed flags |
| FL-14 | **Phone (H)**: responsive triage view + host card. | 390 px layout passes e2e smoke |
| FL-15 | **i18n & a11y pass**: all strings in ru/en, keyboard, focus, contrast in both themes. | axe clean on A–E |

## Plan (FL-1, 2026-09-28)

### What exists
- **DB** (`packages/db`, SQLite + Drizzle, embedded migrations): `boards` (name, position); `instances` (board, product,
  version, track, label, `host` as free text, `source` manual|detector|import|integration, `detected_at`);
  `settings`; `users`/`sessions` (roles admin | viewer); `channels` with config sealed by the instance key
  (`createSealer`, AES-256-GCM, `VD_SECRET_KEY` or a generated key file).
- **Web, self-hosted**: board API (`/api/boards`, `/api/boards/:id/inventory`), board switcher (create, rename,
  delete), settings (boards, notification channels), auth (none / password / OIDC / trusted header), CSRF check by
  Origin, `inventory.yaml` import and watch, signed feed sync, alert runner.
- **Board UI**: one row per product from inventory items; statuses computed in the browser by
  `core.computeStatus()` from the feed's product files; several instances of a product → the worst one decides and
  the detail panel switches between them.
- **Core**: `computeStatus()` (critical / eol / update / ok / news / stale) with tracks as lines, `inTrack()`,
  branches and EOL, advisories with CVSS and KEV.
- **Missing**: sites, hosts as entities, access profiles, polls and history, detectors, a poll scheduler.

### Decisions (reversible, taken to keep going; the owner may veto)
1. **A site is a board.** The `boards` table becomes the list of sites; the board switcher becomes the site switcher
   with «Все площадки» (`?site=<id>`); create / rename / delete stay. One grouping concept instead of two, and
   nothing has been released yet.
2. **Hosts** get their own table (site = board). `instances.host_id` links detected and manual instances to a host;
   `source = manual` is never overwritten by a poll. Host-less instances (today's inventory) keep working.
3. **Status stays client-side**: the server returns hosts with instances; `packages/core` adds `hostStatus()` and
   `productAggregate()` on top of `computeStatus()`. The alert runner uses the same functions.
4. **Poll state lives on the host** (`poll_state`, `poll_since`, `last_attempt_at`, `last_success_at`,
   `poll_error_code`, `poll_error_message`); version and poll changes go to `host_events`.
5. **Access profiles**: new table; secrets sealed with the existing sealer and write-only in the API; Linux profiles
   get a generated ed25519 key pair (private key sealed, public key shown).
6. **Polling engine and real detectors** are ADR-0007 tasks S6-T2/T3, outside the FL list. Until they land,
   `VD_DEMO=1` seeds the fixture and runs a demo detector that answers from it (hosts with a poll problem keep
   failing), so every UI flow works end to end.
7. **Fixture ids → module ids**: windows → windows-server, pve → proxmox-ve, pbs → proxmox-backup-server,
   docker → docker-engine; RouterOS lines 7s / 7lt / 6lt → tracks 7-stable / 7-long-term / 6-long-term.

### Schema (migration 0003)
- `access_profiles(id, name unique, kind linux|windows|mikrotik|pve|pbs, username, secret sealed?, public_key?,
  created_at, updated_at)`
- `hosts(id, board_id → boards cascade, name unique, address, kind linux|windows|mikrotik|proxmox,
  access_profile_id → access_profiles set null, poll_state ok|timeout|denied|unrecognized|pending, poll_since,
  last_attempt_at, last_success_at, poll_error_code, poll_error_message, created_at, updated_at)`
- `instances` + `host_id → hosts cascade` (nullable, indexed) + `read_raw` (what a detector read, for
  unrecognized versions)
- `host_events(id, host_id cascade, at, kind version|poll, product_id?, from_version?, to_version?, state?, message?)`

### API (self-hosted only; writes need admin, viewers read)
Spec §6 with two changes: one `GET /api/fleet?site=` returns sites, profiles (no secrets) and hosts with poll state
and instances, which the board, the hosts table and the phone view all compute from (fine at 300 hosts); poll and
import jobs live in an in-process registry read with `GET /api/poll/jobs/:id` once a second (no SSE in v1).

### Where the spec and the code differ
- The spec header drops «+ Продукт»; host-less products still need a way in (catalog «Добавить на доску» → the
  current site, or the first one under «Все площадки»).
- «Статус неизвестен» (unrecognized version) is new; the engine returns `news` + `invalidVersion` today.
- «Эта неделя» filters by the site's instances instead of a board's items.
- Viewers: the spec is silent; assumed read-only (no poll, no edits, no profiles).

### Order
FL-3 (core, pure and tested against the fixture) → FL-2 (schema + demo seed) → FL-4 reads (`/api/fleet`, host
detail) → FL-6/FL-7 (header, board) → FL-8 (hosts) → FL-9 (host card) → FL-11/FL-10 (profiles, add hosts, jobs)
→ FL-12…FL-15.

### Questions for the owner
1. Is «a site is a board» (decision 1) right for you?
2. Keep host-less manual products in self-hosted, or require a host for every version?
3. One poll schedule for everything (6 h), or per site / per profile?
