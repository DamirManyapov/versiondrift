import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { Module, moduleJsonSchema, validateModules } from '../src/index.ts';
import { MODULE_SCHEMA_FILE, PRODUCTS_DIR, REPO_ROOT, serializeJsonSchema } from '../src/cli/paths.ts';

const schema = moduleJsonSchema();
// Formats (uri, regex) are left to editors; zod checks them at runtime. strictRequired would reject the
// conditional `required` lists in allOf/oneOf, which are valid JSON Schema.
const validateJson = new Ajv2020({
  strict: true,
  strictRequired: false,
  validateFormats: false,
  allErrors: true,
}).compile(schema);

const products = readdirSync(PRODUCTS_DIR)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => {
    const full = path.join(PRODUCTS_DIR, name);
    return { file: path.relative(REPO_ROOT, full), text: readFileSync(full, 'utf8') };
  });

describe('schemas/module.schema.json', () => {
  it('is up to date with the zod schema (run `pnpm schema:gen` if this fails)', () => {
    expect(readFileSync(MODULE_SCHEMA_FILE, 'utf8')).toBe(serializeJsonSchema(schema));
  });
});

describe('products/*.yaml', () => {
  it('has modules to check', () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it.each(products.map((p) => [p.file, p] as const))('%s is valid', (_, product) => {
    const [result] = validateModules([product]);
    expect(result?.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(validateJson(parse(product.text)), JSON.stringify(validateJson.errors)).toBe(true);
  });

  it('pass cross-module checks', () => {
    const errors = validateModules(products).flatMap((r) => r.issues.filter((i) => i.level === 'error'));
    expect(errors).toEqual([]);
  });
});

// Editors must reject what the collector rejects. Rules that JSON Schema cannot express (regex syntax,
// defaultTrack refers to a track, unique track ids) are zod-only and tested in module.test.ts.
describe('JSON Schema agrees with zod', () => {
  const base = {
    id: 'demo',
    name: 'Demo',
    category: 'other',
    versionScheme: 'semver',
    sources: { releases: { type: 'github', repo: 'acme/demo' } },
  };
  const sources = (extra: object) => ({ ...base, sources: { ...base.sources, ...extra } });

  it('both accept a minimal module', () => {
    expect(Module.safeParse(base).success).toBe(true);
    expect(validateJson(base)).toBe(true);
  });

  it.each([
    ['unknown key', { ...base, colour: 'red' }],
    ['bad id', { ...base, id: 'My_Product' }],
    ['unknown category', { ...base, category: 'games' }],
    ['regex scheme without versionRegex', { ...base, versionScheme: 'regex' }],
    ['numeric track id', { ...base, tracks: [{ id: 12, match: '^12' }] }],
    ['unknown source type', sources({ releases: { type: 'svn', url: 'x' } })],
    ['bad github repo', sources({ releases: { type: 'github', repo: 'demo' } })],
    ['extra key in a source', sources({ releases: { type: 'github', repo: 'a/b', branch: 'main' } })],
    [
      'ghsa with both forms',
      sources({ security: [{ type: 'ghsa', repo: 'a/b', ecosystem: 'npm', package: 'b' }] }),
    ],
    ['ghsa without package', sources({ security: [{ type: 'ghsa', ecosystem: 'npm' }] })],
    ['debian without packages', sources({ security: [{ type: 'debian' }] })],
    ['bad cpe', sources({ security: [{ type: 'nvd', cpe: 'grafana' }] })],
    ['two detectors in one item', { ...base, detect: [{ docker: { image: 'a/b' }, file: { path: '/x' } }] }],
    ['empty detect item', { ...base, detect: [{}] }],
    ['bad maintainer', { ...base, maintainers: ['octocat'] }],
  ])('both reject %s', (_, input) => {
    expect(Module.safeParse(input).success).toBe(false);
    expect(validateJson(input)).toBe(false);
  });
});
