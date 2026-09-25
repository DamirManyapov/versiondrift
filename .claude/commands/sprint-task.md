---
description: Implement one task from docs/09-roadmap.md by its id (e.g. S1-T3)
argument-hint: <task-id>
---
Implement task **$ARGUMENTS** from `docs/09-roadmap.md`.

1. Read the task and every doc it depends on (`CLAUDE.md` table "Where things are specified").
2. Write a short plan (files to create/change, tests) and show it before large changes.
3. Implement with tests (fixtures for network code). Keep to the conventions in `CLAUDE.md`.
4. Run `pnpm lint && pnpm typecheck && pnpm -r test` (and `pnpm modules:validate` if modules changed).
5. Update docs if formats or behaviour changed. Mark the task `✅` in `docs/09-roadmap.md`.
6. Propose a Conventional Commit message; do not push.
