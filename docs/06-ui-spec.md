# 06 — UI specification

Reference prototype: `design/prototype.dc.html` (interactive mock with demo data; open the "Stack Radar"
canvas in Claude to click through it). The prototype's data and logic block at the bottom of the file shows the
intended behaviour; its markup shows layout and tokens.

## Routes

| Route | Mode | Content |
|---|---|---|
| `/` | all | **Board**. Anonymous first visit: demo board ("Try it: this is a sample stack") + CTA "Build my board". |
| `/week` | all | "This week" feed for the board's products (or all products when board empty). `?w=2026-W39` for past weeks |
| `/catalog` | all | searchable catalog, filter by category, "Add to board" |
| `/p/:id` | all | product page: latest per track, branches/EOL table, recent releases, advisories, module YAML, source links |
| `/p/:id/:from...:to` | all | **compare page**: merged changelog + advisories fixed between versions. SSR, SEO-indexed |
| `/p/:id/v/:version` | all | "Is :version affected?" page: advisories affecting it, newer releases, EOL. SSR, SEO |
| `/b#s=…` | public | shared board (read-only until "Save to my board") |
| `/settings` | all | inventory import/export (YAML/JSON), thresholds, theme, language; self-hosted: detectors, notifications, users |
| `/status` | all | feed health: last run, modules failing |
| `/docs/*` | all | docs (module guide, API, self-hosting) |
| `/rss/p/:id.xml`, `/rss/b/:ids.xml`, `/rss/week.xml` | all | RSS feeds (board feeds name products only: `/rss/b/grafana,nginx.xml`) |
| `/login`, `/account` | public+accounts | Sprint 7 |

## Board (`/`)

Layout (desktop ≥ 1200 px): header · summary strip · filters · tile grid (left, ~60 %) · detail panel (right, ~40 %).
Tablet: detail panel becomes a slide-over. Phone: single column, tile tap → full-screen detail.

**Header**: logo, view switch `Board | This week`, last feed update ("today 02:14 UTC"), "Refresh" (re-fetch feed),
"+ Product" (catalog modal).

**Summary strip**: 4 counters — Critical, EOL, Updates, Up to date — each a toggle filter.

**Filters**: category chips, text search, "hide OK".

**Tile** (min 172 px high):
- name, category; status chip with **text** (`CVSS 8.1`, `EOL`, `Update`, `Up to date`, `No version`, `Stale data`)
- `installed → latest` in mono; if multiple instances: `11.3.1 (+2 hosts)`
- line: `+5 releases · 2 security · 2 breaking`
- footer: last release date, badge "new this week"
- colour tokens by status (below). Sort: critical, eol, update, news, ok, stale; then name.
- keyboard: tiles are buttons; arrow keys move focus in grid.

**Detail panel**:
1. Title, category, module id link; status chip.
2. Version box: installed → latest; button **"I've updated"** (sets installed = latest, with undo toast);
   track selector (if module has tracks) — "Following: 12.x ▾".
3. Notes/warnings: EOL / EOL soon / new major available / security source unavailable / stale data.
4. Counters: security, breaking, deprecated, feature, fix (over releases newer than installed).
5. "My version": version picker — searchable combobox of known releases (not only pills: products have 100+).
6. Tabs: **Changes since my version (N)** · **Vulnerabilities (N)** · **Module**.
   - Changes: releases newest first, each with date, "this week" badge, link to source; items with type chip;
     security items show CVE + CVSS; toggle **"Important only"** (security/breaking/deprecated);
     divider "your version 11.3.1" at the bottom; "Copy as Markdown" button (for tickets/chats).
   - Vulnerabilities: advisories affecting installed version, score tile, KEV badge, "fixed in", link.
   - Module: YAML with "Edit on GitHub" link.

Implemented (S2-T4) in `apps/web/src/routes/+page.svelte` + `src/lib/board` + `src/lib/components`: one tile per product
(worst instance decides, `(+N)` for more instances; the detail panel switches instances), summary strip and category/
search/hide-OK filters, arrow-key grid navigation, version picker as a searchable `<input list>` over the known
releases, track selector, "I've updated" with an 8 s undo toast, Changes / Vulnerabilities / Module tabs. Below
1100 px the detail panel opens as a full-screen overlay. "Copy as Markdown" (S3-T5) copies the changes since the installed version and the affecting advisories.
`/settings` (S3-T3): critical CVSS threshold, `inventory.yaml` export / import (replace or add), clear board.

## This week (`/week`)

Header: "Sep 21–27: 7 releases, 6 newer than yours, 4 with security fixes". Rows grouped by day:
date, product, version, relevance chip (`affects you · security`, `affects you`, `already installed`, `other track`),
items. Week navigation ‹ ›. Empty state: "Quiet week."

Implemented (S2-T6): the board's products only (all products when the board is empty), relevance per release against
every instance (newer in the same track → "affects you", with "· security" when the release has security items),
previous/next week links over the 12 weeks the feed keeps.

## Catalog modal / page

Search (fuzzy over name, aliases, vendor, keywords), category filter, rows: logo, name, category, source types,
"Add" / "Added". Link: "Missing a product? Add a module →" (docs/10).

Implemented (S2-T5) as the `/catalog` page (the header "+ Product" links there; a modal can come later): every
word of the query must match name, id, vendor, aliases or description. Logos are initials for now — simpleicons would
mean requests to a third-party CDN.

**Demo board:** on the very first visit (nothing saved yet) the board shows a sample stack in memory with a banner
and "Start my own board"; the first edit makes it the user's board and saves it.

**Landing section (S4-T6):** above the demo board, first-time visitors get what VersionDrift is (tagline, three
points), "Build my board" (→ catalog), the GitHub link and the three modes (browser — available now; account and
self-hosted — planned). It is server-rendered so search engines index it; a two-line script in `app.html` marks
visitors with a saved board (`data-returning`) before the first paint, so they never see it flash.

## Inventory storage (anonymous mode)

localStorage key `vd.inventory.v1`:
```json
{ "v": 1, "items": [ { "p": "grafana", "ver": "11.3.1", "track": "11", "label": "prod" } ],
  "settings": { "criticalCvss": 7, "lang": "ru", "theme": "dark" } }
```
All access wrapped in try/catch; if storage is unavailable, keep in memory and show a banner.
Implemented in `apps/web/src/lib/inventory` (`BrowserInventoryStore`, reactive `inventory` state). Settings kept there:
`criticalCvss`, `hideOk`; language and theme are cookies (so the server renders them).

**Line, channel, version** (detail panel, under the version box): "Line" (the product's tracks, or its track groups
when it has update channels, e.g. RouterOS 7 / 6), "Update channel" for grouped products (long-term · 7.23.7, stable,
testing), then "My version" with suggestions from that line. The line and channel default to what the version
suggests (docs/05) and are saved per instance once changed.

**Share link**: `/b#s=<base64url(deflate(JSON items))>`; fragment never reaches the server.
Human-readable variant accepted too: `/b#grafana@11.3.1,poste-io@2.4.5`.
Implemented in S4-T1 (`apps/web/src/lib/inventory/share.ts`): "Share" in the board's filter row opens a panel with the
link; the readable form is used when it is the shorter one (no tracks or labels). Labels are left out unless the user
ticks "Include labels", since they often name hosts. `/b` shows the board read-only (no version field, no "I updated",
no remove) with "Save to my board"; when the visitor already has a board of their own they choose "Add to my board"
(merge, skipping same product + version + label) or "Replace my board". Decoding is capped (256 KB of JSON, 500 items)
and damaged links show an error instead of an empty board; `/b` is `noindex`.
Import/export: YAML file identical to the self-hosted `inventory.yaml` format.

## Accessibility (S3-T6)

axe-core (WCAG 2 A/AA + best practice) reports no violations on `/`, `/week`, `/catalog`, `/p/:id`, `/status`,
`/settings` in dark and light themes. Tiles are buttons with arrow-key navigation; the detail tabs follow the ARIA
tabs pattern (arrows, Home/End); on narrow screens the detail overlay takes focus and Escape returns to the tile;
status chips always carry text.

## Design tokens (from the prototype, dark theme first)

```css
--bg: #121316; --surface: #1F2125; --surface-2: #1A1B1F; --border: #2E3136;
--text: #ECEAE4; --text-muted: #A3A09A;
--critical: #FF6B61; --critical-bg: #35181A; --critical-border: #8C2F2A; --on-critical: #1A0A08;
--update:   #F5A524; --update-bg:   #2A2417; --update-border:   #6E5320; --on-update:   #1A1206;
--ok:       #3DD68C;                                                 --on-ok:       #06170E;
--eol:      #D9D2C3; --eol-bg:      #29251E; --eol-border:      #7A6F5C; --on-eol:      #1B1A17;
--type-security: #FF6B61; --type-breaking: #F5A524; --type-deprecated: #C4A7FF;
--type-feature:  #7CB7FF; --type-fix: #4A4D54;
--font-sans: "IBM Plex Sans", system-ui, sans-serif; --font-mono: "IBM Plex Mono", ui-monospace, monospace;
```
A light theme is required before public launch (tokens redefined under `[data-theme=light]` and
`prefers-color-scheme`). Contrast ≥ 4.5:1 for text; status is always also conveyed by text.

## Controls (UI audit 2026-10, P0)

Two control heights and one set of states, in `apps/web/src/lib/styles` (tokens) and `global.css` (classes):

| Token | Value | Used for |
|---|---|---|
| `--control-h` | 40px | header buttons and segmented tabs, form fields and selects, panel tabs, page-level actions |
| `--control-h-sm` | 32px | buttons in panels, rows of tables and lists, filter chips and the search/checkbox next to them, footer selects |
| `--control-radius`, `--control-radius-sm` | 10px, 8px | |
| `--surface-hover`, `--surface-active`, `--primary-hover`, `--primary-active` | per theme | hover and pressed shades |
| `--selected`, `--selected-bg` | per theme | a selected card |

Classes: `btn` (secondary), `btn-primary`, `btn-ghost`, `btn-danger`, sizes `btn-sm` and `btn-icon`; `chip-btn` for
toggles with `aria-pressed`; `input` / `input-sm` for text fields and selects (`chip` and `field` stay free: status
badges and label wrappers use them). Every control has `:hover`, `:active` (a darker shade and a 1px press),
`:focus-visible` (2px `--focus` ring) and `:disabled` / `aria-disabled` (50% opacity, no hover). Rule: controls in one
row have one height.

A selected card (the one the detail panel shows, `aria-pressed="true"`) has its own look — a 2px `--selected` border
and `--selected-bg` — the same on the fleet board and the board, and it stays when focus leaves; the focus ring is drawn
outside it (`outline-offset: 3px`). Status shows in the card's border, chip and versions, not as a fill of the whole
card. Colour transitions take 0.12s and are off with `prefers-reduced-motion` (the e2e tests run that way).

P1 (same audit): summary tiles are filters — the active one takes its status colour, a "Showing: … · n ✕ Clear"
line sits above the grid, a 0 is disabled, and "Poll problems" is a link with "→" (it leads to the hosts list).
`btn-danger-ghost` is the trigger of a destructive action (neutral, red on hover); the confirmation is inline and
`btn-danger`, and says what follows ("10 hosts use it…"). `select.input` (or `.chevron` inside its own frame) draws one
chevron in both themes. Checkboxes are 18px inside a 32px label row. The header has one "+ Add" menu (a host, hosts
from CSV, a product from the catalog); before signing in it shows only the logo. Navigation buttons end with "→",
actions start with their icon; copying says "✓ Copied" on the button and in a toast.

## Product page (`/p/:id`, S2-T7)

Server-rendered (universal load through `FeedClient`, 404 for unknown ids): latest release, latest per track,
lifecycle table, 15 recent releases with type counts and their security/breaking items, advisories, sources, "Add to
my board". In dev, server-side loads read the local feed through a `handleFetch` hook that is compiled out of builds.

## SEO (compare & version pages)

- `<title>`: "Grafana 11.3.1 → 12.1.2: 3 breaking changes, 2 security fixes | VersionDrift"
- meta description generated from counts; canonical URL normalizes version order and `v` prefixes.
- JSON-LD `SoftwareApplication` + `ItemList` of releases.
- `sitemap.xml`: product pages + compare pages for (each of last 20 releases → latest) and (each branch's latest → latest).
- OG image rendered per page (Workers + satori/resvg) — Sprint 4.

Implemented in S4-T3: `sitemap.xml` is built from `index.json` and `versions.json` (one small file instead of every
product file): product pages, version pages for the 20 recent releases and each branch head, and their comparison with
the latest release when the product's notes have items. `Meta.svelte` sets title, description, `og:title`,
`og:description`, `og:url` and the canonical link; the root layout adds `og:site_name`, `og:image` and
`twitter:card`. JSON-LD `SoftwareApplication` on product and version pages, plus `ItemList` on compare pages.
Per-page OG images are deferred: satori/resvg in Workers would blow the CPU budget of a request, so every page
uses one static card (`static/og.png`, drawn from `design/og-image.html`). Generating images per product in the
collector is the likely next step.

## RSS (S4-T4)

RSS 2.0, language from `Accept-Language` (feed readers send no cookies), items link to our version pages:
- `/rss/p/<id>.xml`: the 30 newest stable releases, important items first in the description, vendor notes linked.
- `/rss/b/<id,id,…>.xml`: releases of those products from the weekly digests (last 12 weeks). The URL carries product
  ids only — never versions — so subscribing to a board feed tells the server nothing about what the user runs.
  Linked from the "Share" panel.
- `/rss/week.xml`: one item per ISO week listing every release in the catalog.
Product and week pages advertise their feed with `<link rel="alternate">`; feeds use the same edge cache as pages.
- Pages must add value beyond vendor notes: merged view, counts, CVE mapping, upgrade notes. No thin pages:
  a compare page with zero items returns 404.

Implemented in S4-T2 (`apps/web/src/lib/seo/pages.ts`, routes `p/[id]/[range=range]` and `p/[id]/v/[version]`):
- Only releases the feed knows get pages; anything else is a 404. `v` prefixes and reversed ranges answer with a 301
  to the canonical URL, which is also the page's `<link rel="canonical">`.
- Compare page: counts per type, "vulnerabilities fixed by this upgrade" (advisories that affect `from` and not `to`),
  breaking changes, security changes and deprecations tagged with their release, then every release in between
  (40 items each, the rest counted and linked to the vendor's notes). JSON-LD: `SoftwareApplication` + `ItemList`.
- Version page: the status engine's verdict with the default threshold (advisories with "fixed in", end of life,
  newer releases in the track, a newer major), newer releases linking to their own pages and comparisons.
- The product page links each release to its version page and to its comparison with the latest release.
- All three are server loads (`+page.server.ts`), so the HTML carries only what the page shows (a universal load
  inlined the whole product file: 1.7 MB of HTML for GitLab). Responses are `public, max-age=600`; on Cloudflare
  `hooks.server.ts` keeps them in the edge cache (`caches.default`), keyed by URL + language + theme.

## i18n

`en` (default) and `ru` from day one — a small typed dictionary in `apps/web/src/lib/i18n` (ADR-0006). Language from
the `vd_lang` cookie, else `Accept-Language`; theme from `vd_theme` (`auto` follows the OS). Vendor text stays in
its original language.

## Implementation notes (S2-T1)

- `apps/web`: SvelteKit 2 + Svelte 5 (runes). `VD_ADAPTER=cloudflare|node` picks the adapter.
- Fonts are served from the app (`@fontsource/ibm-plex-*`), never from Google — no third-party requests.
- `FeedClient` (`src/lib/feed/client.ts`): ETag + in-memory cache, product files checked against the index
  sha256 (one retry bypassing caches). The feed URL is `PUBLIC_FEED_URL`, default `https://feed.versiondrift.dev/`;
  `pnpm web:dev` serves a local `.feed/` at `/feed/` automatically when it exists.
