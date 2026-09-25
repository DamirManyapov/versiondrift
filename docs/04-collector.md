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

## Adapters: notes

- **github**: REST `GET /repos/{repo}/releases?per_page=100` (paginate until known version); `useTags` →
  `GET /repos/{repo}/tags` + commit date. Conditional requests with stored ETag. Many projects (Grafana, Elastic)
  put notes in the release body as Markdown → parse headings into sections.
- **html**: fetch with a descriptive User-Agent (`VersionDriftBot/1.0 (+https://versiondrift.dev/bot)`), parse
  with `cheerio`, extract items per `select`. Respect robots.txt. Store a normalized HTML fingerprint to detect
  layout changes (selector yields 0 items → failure, not "no releases").
- **dockerhub**: `GET https://hub.docker.com/v2/repositories/{repo}/tags?page_size=100` — gives versions and dates only;
  combine with `html`/`rss` for notes.
- **endoflife**: endoflife.date API (verify current version of the API in Sprint 1; v1 is `/api/v1/products/{product}`).
  Map cycles → `branches`.
- **osv**: `POST https://api.osv.dev/v1/query` with `{package:{ecosystem,name}}`; good for packages
  (Debian, npm, PyPI, Go, crates, Maven…). Many *products* are not in OSV — use ghsa/nvd for those.
- **ghsa**: GitHub GraphQL `securityVulnerabilities` (ecosystem packages) or REST
  `GET /repos/{repo}/security-advisories` (repository advisories).
- **nvd**: CVE API 2.0 `?cpeName=` / `virtualMatchString=`, with API key; slow (rate-limited) → incremental by
  `lastModStartDate`. CPE ranges → `affected`.
- **debian**: `https://security-tracker.debian.org/tracker/data/json` (large; download once per run, cache by ETag).
  Map to per-release status for the packages configured (or, self-hosted, the packages detected on hosts).
- **kev**: CISA KEV JSON catalog, downloaded once per run; used only to set `kev: true` on advisories.

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

The prompt lives in `packages/classify/prompts/release.md`, versioned; changing it invalidates the cache.

## Advisory → release linking

For each advisory, compute for every release whether it is affected (`core.isAffected`). A release item of type
`security` that references a CVE id is linked to that advisory; advisories with a `fixed` version that has no
matching security item get a synthetic item `"Fixes CVE-…"` on the fixing release (`classifiedBy: "advisory"`).

## Workflows

- `collect.yml`: cron `0 2 * * *` + `workflow_dispatch` (input: `only` ids). Timeout 30 min. Concurrency group `collect`.
- `module-pr.yml`: on PRs touching `products/**`: validate, run `collect --only <changed> --dry-run`, post a comment
  with the parsed releases table (latest 5), tracks, detected security source, warnings.
- `ci.yml`: lint, typecheck, unit tests, `modules:validate`, schema drift check (`schema:gen` must not change files).

## Local development

```bash
pnpm collect --only grafana --out .feed --no-publish      # writes .feed/v1/...
pnpm collect --only poste-io --record-fixtures            # saves raw responses for tests
FEED_URL=file://$PWD/.feed pnpm web:dev
```
