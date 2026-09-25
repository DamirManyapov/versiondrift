# 03 — Feed format (v1)

Public, read-only, static JSON on `https://feed.versiondrift.dev/v1/`. Anyone may consume it (license CC BY 4.0).
Breaking changes to the format create `/v2/`; additive changes bump `formatVersion` minor.

## Files

| Path | Size target | Purpose |
|---|---|---|
| `v1/index.json` | < 300 KB gz | every product: latest per track, summary, hash of product file |
| `v1/index.json.minisig` | | signature |
| `v1/catalog.json` | small | ids, names, categories, logos, search keywords — for the catalog UI |
| `v1/products/<id>.json` | < 200 KB each | releases, items, advisories, branches |
| `v1/products/<id>/archive-<year>.json` | | releases older than the retention window |
| `v1/health.json` | | per-module collection status (for the status page and module maintainers) |
| `v1/week/<isoYear>-W<isoWeek>.json` | | precomputed weekly digest across all products (for RSS / SEO / "This week") |

## `index.json`

```json
{
  "formatVersion": "1.0",
  "generatedAt": "2026-09-25T02:14:07Z",
  "collectorVersion": "0.3.1",
  "products": {
    "grafana": {
      "name": "Grafana",
      "category": "monitoring",
      "latest": "12.1.2",
      "latestDate": "2026-09-22T00:00:00Z",
      "tracks": { "12": "12.1.2", "11": "11.6.4" },
      "maxSeverityLast30d": "high",
      "hasSecuritySource": true,
      "updatedAt": "2026-09-25T02:10:00Z",
      "stale": false,
      "sha256": "9f1c…",
      "url": "products/grafana.json"
    }
  }
}
```

## `products/<id>.json`

```json
{
  "formatVersion": "1.0",
  "id": "grafana",
  "name": "Grafana",
  "versionScheme": "semver",
  "tracks": [{ "id": "12", "match": "^12\\." }, { "id": "11", "match": "^11\\." }],
  "sources": [{ "type": "github", "url": "https://github.com/grafana/grafana/releases" }],
  "branches": [
    { "id": "12.1", "releaseDate": "2026-08-12", "eol": false, "eolDate": null, "lts": false, "latest": "12.1.2" },
    { "id": "11.3", "releaseDate": "2024-10-22", "eol": true, "eolDate": "2025-07-22", "lts": false, "latest": "11.3.8" }
  ],
  "releases": [
    {
      "version": "12.1.2",
      "sortKey": "b12a1a2`~",
      "track": "12",
      "date": "2026-09-22T00:00:00Z",
      "url": "https://github.com/grafana/grafana/releases/tag/v12.1.2",
      "prerelease": false,
      "items": [
        {
          "type": "security",
          "text": "Stored XSS via dashboard annotations",
          "refs": ["CVE-2026-XXXXX"],
          "classifiedBy": "section"
        },
        { "type": "fix", "text": "PDF export no longer truncates tall panels", "classifiedBy": "section" }
      ],
      "summary": null
    }
  ],
  "advisories": [
    {
      "id": "CVE-2026-XXXXX",
      "aliases": ["GHSA-xxxx-xxxx-xxxx"],
      "title": "Stored XSS via dashboard annotations",
      "cvss": { "score": 8.1, "vector": "CVSS:3.1/AV:N/…", "version": "3.1" },
      "severity": "high",
      "kev": false,
      "published": "2026-09-22T00:00:00Z",
      "affected": [
        { "introduced": "11.0.0", "fixed": "11.6.5" },
        { "introduced": "12.0.0", "fixed": "12.1.2" }
      ],
      "source": "ghsa",
      "url": "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx"
    }
  ],
  "collectedAt": "2026-09-25T02:10:00Z",
  "stale": false
}
```

### Field rules

- `index.json` `url` values carry a version query (`products/grafana.json?v=3f72d49a4d9b`): the query changes with the
  content, so CDN caches never pair a new index with an old product file. The object in R2 is `products/<id>.json`.
- Product files are compact JSON; `index.json` stores the sha256 of exactly those bytes, so the signed index vouches
  for every product file. JSON Schemas: `schemas/feed-product.schema.json`, `schemas/feed-index.schema.json`
  (generated from `packages/schema/src/feed.ts`).
- `releases`: newest first. `date` is `null` when the source gives none; `firstSeenAt` (when the collector first saw
  the release) stands in for it (latestDate, weekly digests). `moreItems`: how many items were left out to keep 40.
- `branches`: only from a lifecycle source (`eol` in the module), ids as that source names them (`13.2`, `12`);
  releases belong to a branch by prefix (`13.2.1` → `13.2`, `12.7` → `12`). `latest` is computed from the feed's
  releases. No lifecycle source → `branches: []` (EOL unknown, never "not EOL").
- `versionRegex` / `branchGroups` are included for `versionScheme: regex` so clients parse versions like the collector.
- `health.json`: `{ ok: 0–1, modules: { <id>: { status: ok|failed, lastAttemptAt, lastSuccessAt, consecutiveFailures,
  releases, error?, warnings[] } } }`.
- `week/*.json`: the last 12 ISO weeks are rewritten on every full run (not on `--only` runs).
- `releases[].sortKey`: opaque, from `sortKey()` in `packages/core`; comparing two keys as plain byte strings gives
  the scheme's version order (equal keys = equal versions), so clients and SQL can `ORDER BY` it without parsing.
  Only comparable within one product. Changes to the encoding bump `formatVersion`.
- `items[].type`: `security | breaking | deprecated | feature | fix | other`.
- `items[].classifiedBy`: `section` (vendor heading), `keyword`, `llm`, `manual`, `advisory` (synthetic "Fixes CVE-…"
  item), `default` (nothing matched, type `other`). UI shows a subtle marker for `llm`.
- `items[].text`: ≤ 300 chars, one bullet, in English as the vendor wrote it (trimmed). No full copies of notes.
- `summary`: optional LLM one-paragraph summary of the release (Sprint 3+), `null` otherwise.
- `advisories[].affected`: OSV semantics; `fixed` exclusive upper bound, `last_affected` inclusive alternative.
- `severity`: from CVSS (`critical ≥ 9`, `high ≥ 7`, `medium ≥ 4`, `low > 0`) or vendor rating when no CVSS.
- Debian: `advisories[].id` may be `DSA-5xxx-1` / `DLA-…` with `affected` expressed per Debian release (`"release": "bookworm"`).

## Weekly digest `week/2026-W39.json`

```json
{ "week": "2026-W39", "from": "2026-09-21", "to": "2026-09-27",
  "entries": [ { "product": "grafana", "version": "12.1.2", "date": "…", "types": ["security","fix"], "maxSeverity": "high" } ] }
```

## Caching

`index.json`, `index.json.minisig` and `health.json` are served with `Cache-Control: public, max-age=300,
stale-while-revalidate=3600`, everything else with `max-age=3600, stale-while-revalidate=86400`; R2 adds strong ETags.
Clients must use conditional requests.
