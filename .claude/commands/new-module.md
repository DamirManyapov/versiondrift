---
description: Create a product module products/<id>.yaml from the template and test it
argument-hint: <product name or id>
---
Create a module for **$ARGUMENTS** following `docs/02-module-spec.md` and `docs/10-contributing-modules.md`.

1. Check `products/` (ids and aliases) — stop if it exists.
2. Research the most official release source (GitHub releases > tags > RSS > HTML changelog > Docker Hub),
   security sources (GHSA / OSV / NVD CPE / vendor advisories feed) and the endoflife.date slug. Verify URLs actually respond.
3. Copy `products/_template.yaml`, fill it in, define `tracks` if several majors are supported in parallel.
4. Run `pnpm modules:validate` and `pnpm collect --only <id> --dry-run`; check latest version and dates against the vendor site.
5. For `html` sources run with `--record-fixtures`.
6. Summarise what was parsed and any warnings.
