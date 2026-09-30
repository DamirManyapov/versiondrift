# 05 — Versions & status engine (`packages/core`)

Pure TypeScript, no Node-only APIs. Used by the browser, Workers, the self-hosted server and the collector.

## Version schemes

| Scheme | Examples | Parse rule | Branch (`branchOf`) |
|---|---|---|---|
| `semver` | `12.1.2`, `v9.1.4`, `8.0.36-28` | strict semver after stripping `v`; build/extra suffix `-N` treated as 4th numeric segment | `major.minor` |
| `loose` | `7.19.4`, `2.5.2`, `5.7.44` | split on `.`/`-`, numeric segments compared numerically, text segments lexically, missing = 0 | first 2 segments |
| `calver` | `2026.09`, `24.04.1` | as loose, but branch = first 2 segments | first 2 segments |
| `debian` | `12.7`, `1:2.3.4-1+deb12u1` | Debian ordering (epoch, upstream, revision; `~` sorts before anything) | major (`12`) |
| `regex` | anything | `versionRegex` capture groups → numeric tuple (a group that didn't match = 0) | first `branchGroups` captures (default 2) |

Details (implemented in `packages/core/src/schemes/`):

- A leading `v` and surrounding whitespace are stripped first (`normalizeVersion`). Numbers are compared as digit
  strings, so any length works up to 26 digits; longer runs don't parse.
- `semver`: exactly `X.Y.Z`, no leading zeros, pre-release precedence per semver.org (`1.0.0-alpha < 1.0.0-alpha.1 <
  1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0`), build metadata ignored. Only a single numeric suffix (`-28`) is a 4th segment;
  `-28.1` stays a pre-release.
- `loose` / `calver`: must start with a digit; atoms are split on non-alphanumerics and digit/letter boundaries, text is
  case-insensitive and sorts **before** numbers and before "missing", so a text suffix reads as a pre-release
  (`7.20rc1 < 7.20 == 7.20.0 < 7.20.1`).
- `debian`: a port of dpkg's `verrevcmp`; case-sensitive, upstream must start with a digit.
- Branches keep the vendor's spelling of the numbers (`24.04`, not `24.4`) and are padded to two parts for
  `loose`/`calver` (`12` → `12.0`); the Debian branch includes a non-zero epoch (`1:2`).
- `sortKey` is an order-preserving string encoding of the parsed version (see `docs/03-feed-format.md`); property
  tests check it against `compare` for every scheme.

API:

```ts
parse(scheme, raw): Version | null        // scheme: a scheme name, or the module (needed for "regex")
compare(scheme, a, b): -1 | 0 | 1          // throws InvalidVersionError for unparseable strings
sortKey(scheme, raw): string          // lexicographically sortable, stored in feed
branchOf(scheme, raw): string
trackOf(module, raw): string | null   // first matching track regex
isAffected(scheme, version, ranges): boolean
```

`isAffected` reads ranges as OSV does (a union), with one exception for backports written as overlapping upper bounds:
n8n lists `< 2.42.1` and `< 2.41.4` for one advisory, meaning the 2.41 line is fixed in 2.41.4. When an advisory has
two or more upper-bound-only ranges and one of them is fixed at or below the version in the version's own line (the
prefix before its last dot), the version is fixed. `fixedIn` then names the fix of the version's own line, else the
lowest fix above it (2.40.7 → 2.41.4, not the pre-release 2.42.1). A single range, or ranges with lower bounds, are
read as before.

Property tests (fast-check): `compare` is a total order; `sortKey` order == `compare` order.

## Inputs to status

```ts
interface Installed { productId: string; version?: string; track?: string; label?: string; host?: string }
interface Settings  { criticalCvss: number /* 7.0 */; treatKevAsCritical: true; eolWarnDays: 90 }
```

## Algorithm

```
product = feed product
if installed.version is empty            → status "news" (show recent releases only)
if product.stale && older than 7 days    → status "stale" (still show last data)

track   = installed.track ?? trackOf(installed.version) ?? module.defaultTrack      // defaultTrack is "latest" unless set
candidates = releases in track (track's regex matches; not prerelease unless the track allows pre-releases)
latest  = max(candidates)
newer   = candidates where compare(release, installed) > 0, sorted desc

affecting = advisories where isAffected(installed.version, a.affected)
branch  = the branch whose id is the longest prefix of installed.version       // "13.2.1" → "13.2", "12.7" → "12"
          else the branch whose id is the scheme's branch of it                 // "10.0.20348.5499" → "20348"

status =
  "critical" if any a in affecting with (a.kev) or (a.cvss.score >= criticalCvss) or (a.severity == "critical")
  "eol"      if branch?.eol or branch.eolDate ≤ today
  "update"   if newer.length > 0
  "ok"       otherwise

flags:
  eolSoon       branch.eolDate within eolWarnDays
  unknownVersion installed.version not found in releases (still compared by scheme)
  otherTrackNewer a newer track exists (e.g. on 8.x, 9.x is out) → hint "new major available" (+ newestOverall)
  invalidVersion  installed.version does not parse under the scheme → status "news"
  staleData       the product is stale (status "stale" overrides everything else)

Implemented in `packages/core/src/status.ts` (`computeStatus`, `isAffected`, `changelog`, `worstStatus`).
Deviations from the first draft, forced by real data: the track is inferred from the version *before* falling back
to `defaultTrack` (the schema default "latest" would otherwise disable tracks), and branches are matched by prefix
because lifecycle sources name them "13.2" for Grafana but "18" for PostgreSQL. Comparisons use the feed's
`sortKey`s; pre-releases are never counted as updates.
```

Priority `critical > eol > update > ok` (an EOL branch with an affecting CVE is `critical`, with the EOL flag shown).

## Output

```ts
interface ProductStatus {
  status: "critical" | "eol" | "update" | "ok" | "news" | "stale";
  installed?: string; latest: string; track: string;
  newer: Release[];                 // for the changelog view
  counts: Record<ItemType, number>; // over `newer`
  affecting: Advisory[];            // sorted by score desc
  maxCvss?: number;
  branch?: Branch; flags: string[];
}
```

## Multiple instances (self-hosted, accounts)

A product may have many `Installed` rows (hosts). Product-level status = worst instance status;
tile shows e.g. "2 of 5 affected", and the detail view lists instances grouped by version.

## Merged changelog `from..to`

`changelog(product, from, to, track?)` → releases with `from < v ≤ to` in the track, newest first,
plus advisories fixed in that range. Used by the detail panel and by compare pages.

## Update channels (overlapping tracks)

Some vendors ship through channels rather than version lines. MikroTik RouterOS has long-term, stable, testing and
development: long-term is one 7.x branch at a time (7.23 as of 2026-09), stable is the newest 7.x, testing adds release
candidates. So tracks may overlap — 7.23.7 is in long-term *and* in stable — and membership is each track's own rule
(`inTrack` in `packages/core/src/tracks.ts`), not the one track a release was first filed under (`release.track`, kept
for display). A track with `prereleases: true` counts release candidates. A module can define a track by a URL naming
the channel's current version (`current`, docs/02); the collector turns it into the regex of that version's
major.minor branch on every run, so the feed carries a plain `match` plus `current`.

Inference picks the first matching track, so the channel listed first wins for its versions: RouterOS 7.23.7 counts
as long-term (up to date, hint "stable has 7.24.4") until the user picks "stable" in the detail panel, and then it is
an update to 7.24.4. A pinned track the product no longer has (a renamed channel) is ignored rather than leaving the
instance with no releases at all.

Tracks can be grouped into product lines (`group`: RouterOS 7, RouterOS 6). The detail panel then asks for the line
first, then the channel within it, then the version — and suggests only that line's versions. Switching the line picks
the channel the installed version fits there, else the line's first channel. Products whose tracks have no group
(Elasticsearch 9/8/7, Debian 13/12) show one "Line" choice.

