# Fleet UI — implementation spec (self-hosted)

Status: approved design · 2026-09-28
Source: brief «Флот хостов» + clickable prototype (canvas «VersionDrift — Флот хостов»; sources in `design/fleet/prototype/`).
Scope: self-hosted mode only (`VD_MODE=selfhosted`). The public site has no hosts.

## 1. Goal

Today versions are entered by hand. For a company with 30–300 hosts this doesn't scale. The self-hosted instance
now polls hosts itself (SSH / API, read-only credentials) every 6 h and the UI shows the fleet:

- **what software is behind** — product board aggregated over hosts;
- **which machines to fix** — hosts table and host card;
- **how it's connected** — access profiles, adding hosts (form / CSV), first-run setup;
- **when polling is broken** — clearly separated from "version is behind".

The existing board, detail panel, "This week" and the product change/vulnerability tabs are **extended, not replaced**.

## 2. Reference prototype — how to read it

`design/fleet/prototype/Main.dc.html` is one interactive file with every desktop screen. It is **not production code**
(custom canvas runtime, inline styles). Use it as:

- **markup** → layout, spacing, copy (Russian), component anatomy;
- **the `<script type="text/x-dc">` block** → data shape, status rules, filters, bulk-action rules, wizard steps,
  error texts. Functions worth porting almost 1:1 into `packages/core` / UI utils: `hostStat`, `agg`, `segsOf`,
  `summaryOf`, `relList`, `plural`, `segLabel`.
- `Phone.dc.html` — mobile triage (P3), `States.dc.html` — every special state in one sheet.

Copy strings from the prototype into i18n (`ru` first, `en` second). Strings must fit in English too.

## 3. Navigation & routes

Header (self-hosted): logo · tabs **Доска · Хосты · Эта неделя · Профили доступа** · site switcher · poll schedule
("Опрос каждые 6 ч / следующий в 18:00") · primary button **Добавить хосты**.

| Route | Screen | Brief id |
|---|---|---|
| `/` | Product board with hosts | A |
| `/hosts` | Hosts table | B |
| `/hosts/:id` | Host card | C |
| `?add=one` / `?add=csv` (modal over any route) | Add hosts | D |
| `/access-profiles`, `/access-profiles/:id` | Profiles list + detail | E |
| `/access-profiles/new?type=…&step=…` | New profile wizard | E |
| `/setup` | First run (empty instance) — `/` redirects here while there are no hosts | G |
| `/week` | Existing screen + site filter | — |

Site filter: `?site=msk|kzn` (absent = all), kept across tabs, also stored per user. It affects board, summary strip,
hosts table and "This week".

## 4. Status model (the core of the feature)

Two **independent** axes:

1. **Version status** of a product instance — from the existing status engine: `critical | eol | update | ok`
   (critical chip shows max CVSS, update chip shows `+N релизов`).
2. **Poll state** of a host — `ok | timeout | denied | unrecognized | pending` with `since` timestamp.

Derived **host status** (table chip, phone list):

```
if host never polled                         → pending   «Ожидает опроса»   (dashed, neutral)
if no product data at all (poll never succeeded) → stale «Нет связи» / «Нет доступа»
worst = worst version status among its products (rank critical < eol < update < ok; tie → higher CVSS)
if poll state ≠ ok and worst ≠ critical      → stale    «Нет связи» / «Нет доступа»
else                                         → worst    (chip of that instance)
```

Rationale: a host we can't reach must not look merely "behind", but a host that was critical at last contact must stay
red — danger is never hidden by missing data (kzn-fs-01 vs kzn-gw-02 in the demo data).

**Product aggregate** (board tile): each instance counts into `critical|eol|update|ok`, except instances on hosts with a
broken poll whose version is not critical → `stale`. Tile status = worst of `critical, eol, update, ok` (ignore stale
unless everything is stale). Never show a tile status by colour alone — the chip always has text.

Lines (tracks): "latest" is always **per line** (Debian 12 → 12.15, 13 → 13.7; RouterOS 7 stable / 7 long-term / 6 long-term).

Manual versions: `source = manual` instances are shown with the «введено вручную» tag; polling never overwrites them.
If a poll finds the same product with a different version, show both and ask the user to choose.

Unrecognized version: keep what was read (e.g. "Windows 10.0.20348, без ревизии обновления"), status **unknown**
(dashed chip «Статус неизвестен»), actions "Показать, что прочитано" / "Указать версию вручную".

## 5. Screens — requirements & acceptance criteria

### A. Board (`/`)
- Summary strip: 4 product counters (Критично / EOL / Обновления / Актуально) as toggle filters + 5th card
  **Проблемы опроса: N хостов** → `/hosts?poll=problem`.
- Tile: name; `категория · N хостов · k критично · k отстаёт/отстают · k EOL`; status chip; **distribution bar**
  (solid segments per status, stale = dashed hollow segment, `role=img` + aria-label); legend with counts;
  up to 3 **line rows** `label · min–max → latest · ×n` (or `latest · последняя`, or `… · EOL`); footer for
  "61 CVE в пропущенных обновлениях" and "kzn-gw-02 не опрашивается".
- Detail panel: header + chip; notes (per-line latest explanation, EOL-soon, unreachable hosts using last known
  version); **Разбивка по версиям** — group per (line, version) sorted by line order then version desc; each group:
  version, line, ×count, chip, host chips (first 3 + «ещё N · показать все N»; unreachable hosts dashed with
  «нет связи/нет доступа»), actions **Что изменилось до X** (inline: intermediate versions if they're sequential
  patches, CVE counts for critical, EOL date for eol, link to the existing "Изменения с моей версии" tab) and
  **Копировать хосты для тикета** (copies the full list, newline-separated).
- Clicking a host chip opens `/hosts/:id`.
- ✅ Demo data renders exactly: Windows `CVSS 9.8 · 7 хостов · 4 критично`; Debian `EOL · 10 хостов · 3 отстают · 1 EOL`;
  RouterOS `Обновления · 10 хостов · 2 отстают` + 1 без связи; PostgreSQL and PBS `Актуально`.

### B. Hosts (`/hosts`)
- Title + count, search (name/address), grouping toggle **По площадкам / Одним списком**.
- Filter chip groups with live counts: Статус (Все/Критично/EOL/Отстают/Актуально), Опрос (Любой/Проблемы опроса),
  Тип (Linux/Windows/MikroTik/Proxmox). All filters are URL params.
- Columns: checkbox · status chip · host (name link + address, mono) · site · OS/firmware (mono) · products count ·
  last poll · poll problem ("Не отвечает с 26.09.2026 14:10", "Отказ в доступе с 25.09.2026").
- Grouped: collapsible site headers `Москва, ЦОД · 22 хоста · 1 критично · 1 EOL · 3 отстают · 17 актуально`;
  inside a group rows sorted by severity then name.
- **Bulk actions** (bar appears when ≥1 selected): Опросить сейчас · Сменить профиль… · Перенести… · Удалить…
  - header checkbox selects **only visible rows** («Выбрать все N по текущему фильтру»);
  - bar shows «из них K скрыто фильтром» when selection includes hidden rows;
  - profile / move / delete open a dialog listing hosts (first 8 + «и ещё N»); delete of >10 hosts requires typing N;
  - poll-now is immediate, result via toast.
- Must stay usable at 300 hosts (virtualized list if needed; group collapse).

### C. Host card (`/hosts/:id`)
- Breadcrumb, name, host status chip, address, site, type, **profile link**, **Опросить сейчас** + «Опрошен сегодня в
  12:00 · следующий в 18:00».
- Poll error block (dashed, neutral): title with since-time, **human explanation + what to do**, action button
  (open profile / poll now), and the last-known-data sentence (critical stays critical vs shown as «Нет связи»).
- Products table: product + line, `version → latest`, chip, source (найдено автоматически / последние известные данные /
  введено вручную); row opens the product in the board panel. Button «+ Продукт вручную».
- History: version changes and poll-state changes with dates.

### D. Add hosts (modal)
- Tab **Один хост**: name, address, site, profile (or «Без профиля — версии вручную») → «Сохранить и проверить связь»
  → inline result; host appears as «Ожидает опроса».
- Tab **Списком из CSV**: dropzone + format help (`name,address,site,profile`, quote sites with commas) →
  **dry-run preview**: summary chips (N новых / N уже есть / N ошибок), errors listed first with line numbers and
  reasons, full table, primary button «Добавить N хостов» (disabled when nothing new) → connection check with progress
  → summary «29 ответили · 1 отказ в доступе · 1 не отвечает» with links to problem hosts.
- Import is an **upsert by name**: existing rows are "без изменений" or "обновится: площадка/профиль".

### E. Access profiles
- List: name, type · user, hosts count, state chip («Работает» / «1 отказ»). Security note: credentials are stored only in
  this instance, encrypted; never root/sudo/admin/write.
- Detail: user, secret «задан · не показывается · заменить», rights text, error explanation that distinguishes
  **one host failing** (host problem) from **all hosts failing** (profile problem), hosts list (failing ones dashed).
- Wizard (3 steps): Тип (Linux / Windows / MikroTik / Proxmox VE / Proxmox Backup) → **Как завести учётку**
  (numbered steps, each command in a code block with «Копировать»; texts live in product modules — prototype has
  drafts for all 5 types) → Данные и проверка (name, user, secret or generated SSH public key with copy;
  «Проверить на хосте» choosing among hosts of that type → success lists found products, or a readable error) → save.
- The instance address (e.g. `10.10.5.20`) is substituted into instructions automatically.

### F. Sites (P2)
Header switcher opens a popover: «Все площадки» + each site with host count, distribution bar and summary text.

### G. First run (P2)
Empty instance → `/setup`: three steps (profile → hosts → first poll) with states done/active/todo; secondary link
"enter versions manually". After import the board opens **immediately** and fills as hosts answer
(«Первый опрос идёт · опрошено 12 из 31» + progress bar; tiles/table update live; unpolled rows «Ожидает опроса»),
then a dismissible result banner with «Показать проблемные».

### H. Phone (P3)
390 px: site chips, 4 host counters, «Требуют внимания» (critical → EOL → no connection → behind, with one-line reason),
collapsed «N хостов в порядке», host card with sticky «Опросить сейчас». No profiles/CSV on mobile.

## 6. Data the UI needs (proposal — adapt to the existing server API)

```
GET  /api/sites                                  → [{id,name,hostCount,statusCounts}]
GET  /api/hosts?site=&q=&status=&poll=&kind=     → [{id,name,address,site,kind,accessProfileId,
                                                     poll:{state,since,lastAttempt,next}, status, products:[…]}]
GET  /api/hosts/:id                              → host + products (+source) + history
POST /api/hosts                                  → create one; returns host (poll.state=pending) + connection check
POST /api/hosts/import?dryRun=1   (text/csv)     → {rows:[{line,name,…,result:new|unchanged|update|error,reason}]}
POST /api/hosts/import            (text/csv)     → {jobId}
POST /api/hosts/poll {ids}                       → {jobId}
GET  /api/poll/jobs/:id                          → {total,done,results:[{hostId,state}]}   (SSE or polling)
PATCH /api/hosts/bulk {ids, accessProfileId?|siteId?}
DELETE /api/hosts/bulk {ids}
GET/POST/PATCH /api/access-profiles[/:id]        → secret write-only
POST /api/access-profiles/:id/test {hostId}      → {ok, found:[…]} | {ok:false, error:{code,message}}
GET  /api/products/aggregate?site=               → board tiles (or compute client-side from /api/hosts)
```

Error codes for polls, each with a UI text and a suggested action: `timeout`, `refused`, `auth_denied`,
`password_expired`, `host_key_mismatch`, `tls_error`, `unrecognized_version`.

## 7. Design tokens

Dark is primary, light is required. Tokens (from the brief) are in `design/fleet/tokens.css`; map them onto the existing
`tokens.css`. Fonts: IBM Plex Sans (UI), IBM Plex Mono (versions, addresses, builds, numbers in tables).
Radii 10 px (controls) / 14 px (tiles, panels). Status is never colour-only. Stale/pending = dashed neutral.

## 8. Accessibility

Real buttons/links/inputs; visible focus; tables keyboard-navigable; icon buttons have `aria-label`; distribution bars
have text alternatives; dialogs trap focus and restore it; contrast WCAG AA in both themes.

## 9. Out of scope

Zabbix / vCenter / Ansible host import (later), agents on servers, multi-tenant integrator console, new notification
screens (only mention new events «хост отстал», «хост не отвечает» in existing notification settings), public site.

## 10. Test oracle

`fixtures/fleet-demo.json` — 31 hosts / 2 sites / 5 profiles with `expected` statuses. Use it for:
unit tests of host/product aggregation, a dev seed (`VD_DEMO=1`), and Playwright e2e checks of the numbers in §5.A.
