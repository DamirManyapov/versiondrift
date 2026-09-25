# 04 — Collector

`apps/collector` — a Node CLI run daily by GitHub Actions (`.github/workflows/collect.yml`).

## Run lifecycle

```
1. load modules          products/*.yaml → validate (zod) → skip invalid, report
2. load previous feed    GET feed.versiondrift.dev/v1/index.json + needed product files
3. load state            R2 versiondrift-state: http-cache/, llm-cache/
4. collect (parallel, concurrency 8, per-host rate limits)
     releases   → adapter.fetchReleases(since = last known version date − 30d)
     lifecycle  → adapter.fetchLifecycle
     advisories → adapter.fetchAdvisories
5. normalize             parse versions, apply tagFilter/prerelease, assign tracks, sortKey
6. classify              notes → items (pipeline below)
7. match advisories      merge by CVE/GHSA alias, attach KEV flag, compute severity
8. merge with previous   new releases appended; unchanged releases keep previous items (stable output)
9. build                 index.json, catalog.json, products/*.json, week/*.json, health.json
10. diff & guard         refuse to publish if > 20 % of products lost releases or index shrinks > 10 %
11. sign & publish       minisign index.json → wrangler r2 object put (products first, index last)
12. report               health.json + GitHub step summary; open/update an issue per broken module
```

Failure policy: a module whose collection fails keeps its previous data with `stale: true` and
`lastSuccessAt`. After 3 consecutive failures an issue is opened, mentioning `maintainers`.

## Implementation notes (`apps/collector`)

- Modules run 8 at a time. `sources.releases` defines the set of releases; `releasesExtra` only enrich releases the
  primary source knows (notes, dates, links) — they never add versions.
- Normalization: `tagFilter` on the raw version → parse under `versionScheme` (unparseable versions are dropped and
  reported as a warning with examples) → pre-releases (source flag, or alpha/beta/rc/pre/preview/dev/snapshot/
  nightly/canary in the version) dropped unless `prerelease: include`.
- Merge: releases from the previous feed are kept (union). Their items are recomputed only when the module definition
  or `CLASSIFIER_VERSION` changed (`moduleHash`), and only for releases the source still offers; `sortKey` and
  `track` are always recomputed, so editing a module applies immediately. New releases get `firstSeenAt` = run time.
  Bump `CLASSIFIER_VERSION` in `packages/classify` when rule changes should reach published items.
- First runs fetch back to the retention window (3 years); later runs stop at the first page with a known version.
- A module whose release source fails, or that yields no usable release, keeps its previous product file with
  `stale: true` and `lastSuccessAt`; a module without previous data is left out. Lifecycle/extra source failures are
  warnings (the previous branches are kept).
- The run exits 0 even if some modules fail (see `health.json`), 1 if all failed, 2 if the guard blocks writing.
- HTTP cache: `--cache-dir` (default `.cache/http`); entries not used by a full run are pruned.

## Fetcher (`packages/adapters/src/http`)

Adapters never call `fetch` directly; they get a `Fetcher` in their context:

- User-Agent `VersionDriftBot/1.0 (+https://versiondrift.dev/bot)`; per-host auth headers (GitHub token) that are never
  logged or recorded.
- Per-host pacing: requests to one host are serialized with a minimum gap between starts (default 500 ms,
  `api.github.com` 100 ms); different hosts run in parallel.
- Retries (3) with exponential backoff for network errors, 429 and 5xx; `Retry-After` and GitHub's
  `x-ratelimit-reset` are honoured when the wait is ≤ 60 s, otherwise the request fails (no hour-long sleeps).
- Timeout 30 s per attempt.
- Conditional GET: with an `HttpCache` (`FileHttpCache` = one JSON file per request), `If-None-Match` /
  `If-Modified-Since` are sent and a 304 returns the stored body (`fromCache: true`).
- Fixtures: `recordingFetch` saves every response as `<host_path_query>-<hash>.json` (status, a few headers, body —
  never request headers); `fixtureFetch` replays them and fails on any request without a fixture.

## Adapters: notes

- **github** (verified 2026-09): REST `GET /repos/{repo}/releases?per_page=100&page=N`, drafts skipped, paging stops
  at a page containing a known version, at releases older than the retention window, or after 10 pages. `useTags` →
  GraphQL `refs(refPrefix: "refs/tags/", orderBy: TAG_COMMIT_DATE)`, 100 tags with tagger/commit dates per request
  (needs a token). `notesFrom: changelogFile` → `GET /repos/{repo}/contents/{path}` (raw), split by version headings.
  Many projects (Grafana, Elastic) put notes in the release body as Markdown → parse headings into sections.
- **html**: fetch with a descriptive User-Agent (`VersionDriftBot/1.0 (+https://versiondrift.dev/bot)`), parse
  with `cheerio`, extract items per `select`. Respect robots.txt. Store a normalized HTML fingerprint to detect
  layout changes (selector yields 0 items → failure, not "no releases").
- **dockerhub** (verified 2026-09): `GET https://hub.docker.com/v2/repositories/{repo}/tags?page_size=100&ordering=last_updated`
  (`nginx` → `library/nginx`), `tagRegex` applied in the adapter — gives versions and dates only; combine with
  `html`/`rss` for notes.
- **endoflife** (verified 2026-09, schema 1.2.1): `GET https://endoflife.date/api/v1/products/{product}` →
  `result.releases[]` (`name, codename, releaseDate, isLts, isEol, eolFrom, latest`) → `branches`.
- **rss** (verified 2026-09): RSS 2.0 (`pubDate`, `content:encoded`/`description`), RSS 1.0/RDF (`dc:date`) and Atom.
- **osv**: `POST https://api.osv.dev/v1/query` with `{package:{ecosystem,name}}`; good for packages
  (Debian, npm, PyPI, Go, crates, Maven…). Many *products* are not in OSV — use ghsa/nvd for those.
- **ghsa**: GitHub GraphQL `securityVulnerabilities` (ecosystem packages) or REST
  `GET /repos/{repo}/security-advisories` (repository advisories).
- **nvd**: CVE API 2.0 `?cpeName=` / `virtualMatchString=`, with API key; slow (rate-limited) → incremental by
  `lastModStartDate`. CPE ranges → `affected`.
- **debian**: `https://security-tracker.debian.org/tracker/data/json` (large; download once per run, cache by ETag).
  Map to per-release status for the packages configured (or, self-hosted, the packages detected on hosts).
- **kev**: CISA KEV JSON catalog, downloaded once per run; used only to set `kev: true` on advisories.

Security sources as implemented (S3-T1, verified 2026-09):
- **ghsa**: REST `/repos/{repo}/security-advisories` (published, newest first) or `/advisories?ecosystem=&affects=`.
  Vendor range strings are free-form; `parseRangeExpression` handles `>= a, < b`, `a - b`, space-separated pairs,
  `||`, drops wildcard bounds (`<9.x`), and with several patched versions ("9.3.2, 9.2.8, 8.5.16") builds one range
  per patched branch while unpatched branches in between stay affected.
- **nvd**: `?virtualMatchString=<cpe>&resultsPerPage=2000`; CVSS from v3.1 → v3.0 → v4.0 → v2; ranges from the
  CVE's `cpeMatch` entries for the module's vendor:product (exact CPE versions become single-version ranges). The
  shared fetcher paces NVD at 6.5 s (0.7 s with `NVD_API_KEY`).
- **osv**: `POST /v1/query`; events → ranges; a CVE alias becomes the id.
- `debian` and `rss` security sources yield no advisories yet (per-package Debian data needs the self-hosted inventory;
  RSS announcements carry no version ranges) — they are listed as source links only.
- Merge: one advisory per vulnerability, keyed by CVE id and aliases; ranges from the most precise source (GHSA, OSV,
  then NVD) that has any; CVSS from the first source with a score; `kev` from the catalog; newest first. If every
  security source of a module fails, its previous advisories stay.
- Linking: a release that is some advisory's `fixed` version gets a synthetic item "Fixes CVE-…: title"
  (`classifiedBy: advisory`) unless its own items already reference the CVE/GHSA; recomputed every run.
- `index.json` `maxSeverityLast30d` = highest severity among advisories published in the last 30 days; weekly digest
  entries carry the highest severity fixed in that release.

All endpoints above must be re-verified when the adapter is implemented; record real responses as fixtures.

## Classification pipeline (`packages/classify`)

Input: release notes (Markdown/HTML/plain) + module `classify` hints. Output: `items[]`.

1. **Split** notes into bullets. Markdown lists, HTML `<li>`, or sentences for prose.
2. **Section mapping** — if the bullet is under a heading matched by module `classify.sections` or the default
   dictionary (`Security`, `Breaking changes`, `Deprecations`, `Bug fixes`, `Features`, `Enhancements`, …)
   → `classifiedBy: "section"`.
3. **Keyword rules** — regex dictionary (`CVE-\d{4}-\d+` → security; `breaking|removed|no longer|drop(ped)? support`
   → breaking; `deprecat` → deprecated; `fix(ed)?|bug` → fix) plus module keywords → `classifiedBy: "keyword"`.
4. **LLM (optional, Sprint 3)** — for releases where > 30 % of bullets are still `other`, or the notes are prose.
   One call per release, strict JSON output validated by zod, temperature 0, cached by content hash,
   budget cap per run (`LLM_MAX_CALLS`, default 200). → `classifiedBy: "llm"`.
   Also produces an optional `summary` (≤ 400 chars) and a short "upgrade notes" hint for breaking releases.
5. **Trim & dedupe** — max 300 chars per item, max 40 items per release (rest collapsed into "+N more" with the
   release URL).

Details of v1 (`packages/classify`, no LLM):
- Parsing: Markdown via `marked`, HTML via `cheerio` (`li` = bullet, `h1–h6` = heading, bold-only paragraph = heading),
  text by lines (`- * • + 1.` bullets, `Heading:` lines). If an HTML body has no structure it is read as text with
  `<br>` as line breaks; if a text has MikroTik-style `*) ` bullets, only those count. Prose paragraphs become items
  only when the notes have no bullets at all (max 3).
- Headings use the nearest heading that means something (version headings are transparent). Default terms, first
  match wins: security > breaking (incl. Keep-a-Changelog "Removed") > deprecated > fix > feature ("Added",
  "Enhancements"…) > other ("Changed", "Dependencies"…). Sections like "New Contributors" or "Checksums" are
  dropped, as are boilerplate lines ("Download page", "Full Changelog").
- An item that mentions a CVE or GHSA id is `security` whatever its section (`classifiedBy: keyword`), with the ids
  in `refs`. Keyword rules only apply when the section gave no specific type; "fix" must be the item's verb, so
  "a fixed offset" stays `other`.
- Conventional Commits prefixes decide first (`fix:` → fix, `feat:` → feature, `feat!:`/`BREAKING CHANGE` → breaking,
  `docs:`/`chore:`… → other). "Removed …" as the item's verb is breaking; "remove" inside a sentence is not.
- Link-only lines ("Downloads: https://…") and version boilerplate ("18.6 is the latest release…") are dropped. A prose
  paragraph that names a CVE is kept even when the notes have bullets.
- `releasesExtra` notes replace primary notes that yield no items (Elastic's GitHub releases only link to the notes).
- GitHub reference noise is removed: `[#123](…)`, `[@user](…)`, "by @user in https://…/pull/1".
- When more than 40 items remain, the least important types are dropped first (security and breaking are kept),
  original order is preserved and the count is reported as omitted.

The prompt lives in `packages/classify/prompts/release.md`, versioned; changing it invalidates the cache.

## Advisory → release linking

For each advisory, compute for every release whether it is affected (`core.isAffected`). A release item of type
`security` that references a CVE id is linked to that advisory; advisories with a `fixed` version that has no
matching security item get a synthetic item `"Fixes CVE-…"` on the fixing release (`classifiedBy: "advisory"`).

## Workflows

- `collect.yml`: cron `0 2 * * *` + `workflow_dispatch` (inputs: `only` ids, `force`). Timeout 30 min. Concurrency group
  `collect`. Steps: `pnpm collector state-pull` (HTTP cache from the private bucket) → `pnpm collect` →
  `pnpm collector publish` (sign + upload via the R2 REST API: products first, unchanged ones skipped, then
  signature and index) → `state-push` → `pnpm collector issues` (opens "Module X is failing" with label
  `module-broken` after 3 consecutive failures, closes it on recovery) → the built feed as an artifact.
- `module-pr.yml`: on PRs touching `products/**` (`pull_request_target`: workflow and collector from `main`, only the
  PR's `products/*.yaml` are taken, never its code): `modules:validate`, then `pnpm collector pr-report --only <changed>
  --pr <n>` dry-runs the changed modules against the published feed and posts one comment (updated on every push):
  latest 5 releases with dates, tracks and item types, lifecycle branches, security sources, warnings. The job fails
  when a module is invalid or cannot be collected.
- `ci.yml`: lint, typecheck, unit tests, `modules:validate`, schema drift check (`schema:gen` must not change files).

## Local development

```bash
pnpm collect --only grafana --out .feed --no-publish      # writes .feed/v1/...
pnpm collect --only poste-io --record-fixtures            # saves raw responses for tests
FEED_URL=file://$PWD/.feed pnpm web:dev
```
