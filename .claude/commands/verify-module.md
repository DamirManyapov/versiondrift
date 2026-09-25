---
description: Verify an existing module against live sources and fix it
argument-hint: <id>
---
Verify `products/$ARGUMENTS.yaml`: every URL/repo/CPE/slug responds, tag filters keep only real releases,
latest version equals the vendor's site, dates are right, security items are recognised.
Fix the module, remove the `# DRAFT` line when fully verified, and report what changed.
