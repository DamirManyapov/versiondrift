# ADR-0005: License

Status: **accepted** · 2026-09-26

## Context

VersionDrift should be open source and self-hostable by anyone, including companies, while leaving room for a paid
offering later (a hosted/teams plan, an enterprise edition with SSO, roles, audit, support). A closed commercial
clone of the public service should not be possible.

Options considered:
1. **AGPL-3.0** for code — anyone running a modified version for users over a network must publish the changes
   (Grafana, Mattermost, Nextcloud). Internal use in companies, modified or not, is free and unrestricted.
   Some corporate legal departments avoid AGPL; they can buy a commercial license (see below).
2. **Apache-2.0 / MIT** — maximum adoption; anyone may run a closed commercial clone.
3. **FSL / BUSL** (source-available, converts to Apache after 2 years) — protects against competing services, but is
   not open source, which part of the community rejects.

## Decision

- **Code: `AGPL-3.0-only`** (`LICENSE`, `LICENSES/AGPL-3.0-only.txt`, `"license"` in every `package.json`).
- **Contributor License Agreement** for code and documentation (`CLA.md`, adapted from the Apache ICLA v2.2): the
  contributor grants the Maintainer a license that allows distributing contributions under other licenses too,
  including commercial ones. Collected by the CLA Assistant Lite bot on the PR (`.github/workflows/cla.yml`).
  This keeps dual licensing / an enterprise edition possible, and keeps the option to move to a more permissive
  license later (the reverse — going from MIT to AGPL — is impossible for already released code).
- **Data: `CC-BY-4.0`** for product modules (`products/**`) and the published feed (`LICENSES/CC-BY-4.0.txt`).
  Inbound = outbound: submitting a module licenses it under CC BY 4.0; no CLA needed, so module contributions stay
  frictionless.

## Consequences

+ Companies can install and use VersionDrift internally for free, with or without changes.
+ A paid edition or commercial license can be sold, because the Maintainer can relicense all code.
− A CLA adds one step for code contributors (not for module authors).
− `CLA.md` is an adaptation, not a lawyer-reviewed document: have it reviewed before selling a commercial license.
