# ADR-0001: TypeScript monorepo (pnpm workspaces)

Status: accepted · 2026-09-25

## Context
We need the same logic (version comparison, status engine, schemas) in the browser, Cloudflare Workers,
a Node collector and a Node self-hosted server.

## Decision
TypeScript everywhere, pnpm workspaces, shared `packages/schema` and `packages/core`.

## Consequences
+ one language for contributors, shared types end-to-end.
− no single static binary for self-hosted (Go would give that); Docker is the distribution unit instead.
