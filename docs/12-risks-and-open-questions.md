# 12 — Risks & open questions

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| HTML sources change layout → silent breakage | wrong/stale data | 0 items = failure; fingerprints; health page; auto-issues to maintainers; prefer APIs/feeds |
| Classification wrong (missed security item) | false "green" | status `critical` is driven by **advisory databases**, not by note keywords; notes classification only affects highlighting |
| CVE coverage gaps for non-package products | missed red tiles | combine GHSA + NVD CPE + vendor RSS; show "security data not available" per module instead of implying safety |
| Version string zoo (hotfix tags, epochs, date versions) | wrong comparisons | per-module scheme + regex + property tests + `unknownVersion` flag |
| GitHub API limits as modules grow | failed runs | ETag cache, incremental fetch, spread runs by shard (modules hashed into 4 shards, 4 cron slots) |
| Content licensing of release notes | takedown requests | short bullets + link, credit sources, honour opt-out requests, robots.txt |
| Thin SEO pages penalised | no organic traffic | 404 for empty comparisons, real added value (merged view, CVE mapping), limited sitemap |
| Inventory = sensitive data | trust | anonymous mode local-only; accounts store product+version only; self-hosted |
| Maintainer burnout (one person) | project stalls | automation first (bots, health), modules maintained by contributors, narrow scope per sprint |
| LLM costs / hallucinations | money / wrong items | optional, budget cap, cached, labelled `llm`, never decides status |

## Open questions (decide by the sprint noted)

1. **License** (S0): AGPL-3.0 (protects the hosted service from closed forks; Grafana-style) vs MIT/Apache
   (maximum adoption, easier corporate use). See ADR-0005.
2. **Where the feed repo lives** (S0): same repo as the app, or a separate `versiondrift/modules` repo so contributors
   don't need the app toolchain? Default: same repo; split if PR volume on modules gets large.
3. **LLM provider** (S3): which API, budget per month, whether to allow self-hosted instances to plug their own key.
4. **Tracks defaults** (S2): when a user sets version 8.15.2 for Elasticsearch, do we auto-pin track 8.x? Proposed:
   auto-pin to the installed major if that major is still supported, else `latest`.
5. **Monetisation** (after S8): teams tier on the hosted version, sponsorships (GitHub Sponsors, Open Collective),
   or none.
6. **Name** (S0): confirm VersionDrift, check trademarks (EUIPO/USPTO/Rospatent quick search).
7. **Delivery where hosts are blocked** (idea from the owner, 2026-09-28, to think about): in Russia some of the
   places we publish to (Cloudflare for the feed, ghcr.io / Docker Hub for the image) may be slow or unreachable.
   What already helps: a self-hosted instance never talks to vendors, only to the feed, and the feed is signed, so it
   can travel over any channel like antivirus bases; `VD_FEED_URL` points at any mirror, and an instance's `/feed/`
   is itself a mirror for others. Options: a second mirror in Russia (S3-compatible storage the collector also
   publishes to), an offline update bundle (one signed archive to download anywhere and import through the UI or a
   folder, for closed networks), and the image as a `docker save` archive or on a second registry.
