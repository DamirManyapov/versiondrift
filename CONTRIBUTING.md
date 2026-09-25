# Contributing to VersionDrift

Thanks for helping! The most valuable contribution is a **product module**: a small YAML file that teaches
VersionDrift where a product publishes its releases, security advisories and end-of-life dates. No code needed.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Add or fix a product module

1. Read the [module guide](docs/10-contributing-modules.md) and the [module spec](docs/02-module-spec.md).
2. Copy `products/_template.yaml` to `products/<id>.yaml` (`id`: lowercase kebab-case, stable forever).
3. Check it: `pnpm modules:validate` (errors point at `file:line:col`). Your editor validates as you type if the
   file starts with `# yaml-language-server: $schema=../schemas/module.schema.json`.
4. Open a PR titled `module(<id>): add <Name>`.

Can't write the module yourself? Open a [module request](../../issues/new?template=module_request.yml).

## Report a bug

Use the [bug report](../../issues/new?template=bug_report.yml) form. Issues are public: leave out hostnames, IPs and
anything else about your infrastructure.

## Work on the code

Requirements: Node.js ≥ 22.18 (see `.nvmrc`) and [pnpm](https://pnpm.io/installation). The exact pnpm version is
pinned in `package.json` and pnpm switches to it automatically.

```bash
pnpm i
pnpm lint && pnpm typecheck && pnpm -r test   # what CI runs, plus the two below
pnpm modules:validate
pnpm schema:gen                               # after changing packages/schema; commit schemas/*.json
pnpm format                                   # Prettier
```

Before you start on something bigger, read [`docs/00-vision.md`](docs/00-vision.md) and
[`docs/01-architecture.md`](docs/01-architecture.md), and open an issue to discuss it. Conventions:

- **Privacy first:** the public feed never contains anything about a user; self-hosted data never leaves the instance.
- **Modules are data, not code.** A new *source type* is an adapter in `packages/adapters` with recorded fixtures;
  tests never hit the network.
- **Tests** for new logic (`test/*.test.ts` next to `src/`), and docs in `docs/` updated when behaviour or formats change.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(collector): …`,
  `fix(web): …`, `module(grafana): …`.
- User-facing strings go through i18n (`en` first, then `ru`).
