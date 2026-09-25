# ADR-0005: License

Status: **proposed** — decide in S0

Options:
1. **AGPL-3.0** for code — anyone running a modified hosted version must publish changes (Grafana, Plausible, Umami-like
   projects use AGPL). Protects a future hosted/teams offering. Some companies avoid AGPL dependencies,
   but VersionDrift is an application, not a library, so impact is small.
2. **Apache-2.0 / MIT** — maximum adoption and corporate friendliness; anyone may run a closed commercial clone.

Data (modules, feed): **CC BY 4.0** in both cases — attribution required, reuse welcome.

Recommendation: AGPL-3.0 code + CC BY 4.0 data.
