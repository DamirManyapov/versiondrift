# ADR-0004: User inventory is never part of the public data path

Status: accepted · 2026-09-25

Anonymous inventory lives in localStorage / URL fragment. Accounts store product+version(+label) only.
Hosts, IPs and credentials exist only in self-hosted instances. Analytics are privacy-friendly (Plausible/Umami or
Cloudflare Web Analytics) and never include inventory contents.
