# Design

- `prototype.dc.html` — the clickable prototype ("Stack Radar" canvas made in Claude). It runs inside Claude's
  design canvas runtime, so it will not open as a normal web page. Use it as a **reference**:
  - markup = layout, spacing, colours (tokens are listed in `docs/06-ui-spec.md`);
  - the `<script type="text/x-dc">` block at the bottom = demo data shape and intended behaviour
    (status rules, filters, version pills, "I've updated", weekly feed, catalog).
- All versions, dates and CVE ids in the prototype are fictional demo data.
- Differences to implement vs the prototype: searchable version picker instead of pills, track selector,
  light theme, responsive layouts, multiple instances per product, "news" and "stale" statuses.
