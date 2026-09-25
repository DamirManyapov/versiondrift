# 10 — Contributing a module

Thanks for adding a product! A module is one YAML file in `products/`.

## 1. Check it doesn't exist

Search `products/` and the catalog on versiondrift.dev (also by aliases). Open a "Module request" issue if you
only want to ask for one.

## 2. Copy the template

```bash
cp products/_template.yaml products/<id>.yaml
```

`<id>`: lowercase, hyphens, the product's common name (`proxmox-ve`, `poste-io`). It never changes later.

## 3. Pick the release source (in this order of preference)

1. **GitHub / Gitea / Forgejo releases** with notes in the body → `type: github` or `type: gitea` (best data).
2. Tags only → `type: github` with `useTags: true` + a changelog page as `releasesExtra`.
3. Official **RSS/Atom** feed of releases → `type: rss`.
4. A changelog **web page** → `type: html` with CSS selectors.
5. Only Docker images → `type: dockerhub` (versions only) + an html/rss source for notes.

## 4. Add security and lifecycle sources if they exist

- Product on endoflife.date? → `eol: { type: endoflife, product: <slug> }`. If not, consider contributing it there.
- GitHub repository advisories → `ghsa`. Package ecosystems → `osv`. Otherwise NVD `cpe`.

## 5. Versions

Choose `versionScheme`. Use `tagFilter` to drop pre-releases, nightly builds and unrelated tags.
If the product maintains several major lines at once, define `tracks`.

## 6. Test locally

```bash
pnpm modules:validate
pnpm collect --only <id> --dry-run      # prints parsed releases, tracks, item types
```

Check: latest version correct? dates correct? notes split into sensible items? security items recognised?
For `html` modules run with `--record-fixtures` and commit the fixture.

## 7. Open a PR

Title: `module(<id>): add <Name>`. The bot comments with what it parsed. Add yourself to `maintainers` if you're
willing to be pinged when the source changes.

## Review checklist (maintainers)

- [ ] id/name/category sensible, no duplicate
- [ ] release source is the most official available
- [ ] ≥ 5 releases parsed, latest matches the vendor site
- [ ] tags filtered (no rc/beta unless `prerelease: include` is justified)
- [ ] security source present or `noSecuritySource` warning acknowledged
- [ ] html selectors are robust (ids/semantic tags over generated classes)
