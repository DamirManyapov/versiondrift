import { describe, expect, it } from 'vitest';
import { validateModuleFile, validateModules, type ModuleFile } from '../src/index.ts';

const yaml = (lines: string[]) => lines.join('\n') + '\n';

const demo = yaml([
  'id: demo', // 1
  'name: Demo', // 2
  'category: other', // 3
  'versionScheme: semver', // 4
  'sources:', // 5
  '  releases: { type: github, repo: acme/demo }', // 6
  '  security:', // 7
  '    - { type: nvd, cpe: "cpe:2.3:a:acme:demo" }', // 8
]);

const file = (name: string, text: string): ModuleFile => ({ file: `products/${name}.yaml`, text });

describe('validateModuleFile', () => {
  it('returns the parsed module and no issues for a valid file', () => {
    const result = validateModuleFile(file('demo', demo));
    expect(result.issues).toEqual([]);
    expect(result.module?.id).toBe('demo');
  });

  it('points schema errors at the offending key', () => {
    const text = demo.replace('repo: acme/demo', 'repo: acme-demo');
    const [issue] = validateModuleFile(file('demo', text)).issues;
    expect(issue).toMatchObject({ code: 'schema', path: 'sources.releases.repo', line: 6, column: 29 });
  });

  it('points an unknown key at that key', () => {
    const text = demo.replace('category: other', 'category: other\ncolour: red');
    const [issue] = validateModuleFile(file('demo', text)).issues;
    expect(issue).toMatchObject({ code: 'schema', line: 4, column: 1 });
    expect(issue?.message).toContain('colour');
  });

  it('points a missing key at the object that should contain it', () => {
    const text = demo.replace('  releases: { type: github, repo: acme/demo }\n', '');
    const [issue] = validateModuleFile(file('demo', text)).issues;
    expect(issue).toMatchObject({ code: 'schema', path: 'sources.releases', line: 5, column: 1 });
  });

  it('points list errors at the list item', () => {
    const text = demo.replace('cpe: "cpe:2.3:a:acme:demo"', 'cpe: demo');
    const [issue] = validateModuleFile(file('demo', text)).issues;
    expect(issue).toMatchObject({ path: 'sources.security[0].cpe', line: 8, column: 20 });
  });

  it('reports YAML syntax errors with a position', () => {
    const [issue] = validateModuleFile(file('demo', demo.replace('name: Demo', 'name: [Demo'))).issues;
    expect(issue).toMatchObject({ level: 'error', code: 'yaml' });
    expect(issue?.line).toBeGreaterThan(0);
  });

  it('rejects duplicate keys', () => {
    const [issue] = validateModuleFile(file('demo', demo + 'name: Again\n')).issues;
    expect(issue).toMatchObject({ code: 'yaml', line: 9 });
  });

  it('requires the id to equal the file name', () => {
    const [issue] = validateModuleFile(file('other', demo)).issues;
    expect(issue).toMatchObject({ level: 'error', code: 'idMismatch', line: 1 });
  });

  it('warns when a module has no security source', () => {
    const text = demo.replace(/ {2}security:\n.*\n/, '');
    const { issues, module } = validateModuleFile(file('demo', text));
    expect(module).toBeDefined();
    expect(issues).toEqual([
      expect.objectContaining({ level: 'warning', code: 'noSecuritySource', line: 5 }),
    ]);
  });

  it('checks templates against the schema only', () => {
    const template = demo.replace('id: demo', 'id: my-product').replace(/ {2}security:\n.*\n/, '');
    expect(validateModuleFile(file('_template', template)).issues).toEqual([]);
    const broken = template.replace('category: other', 'category: nope');
    expect(validateModuleFile(file('_template', broken)).issues).toHaveLength(1);
  });
});

describe('validateModules', () => {
  const other = demo.replaceAll('demo', 'other');

  it('rejects an alias that is another module id', () => {
    const text = demo.replace('name: Demo', 'name: Demo\naliases: [legacy, other]');
    const [first, second] = validateModules([file('demo', text), file('other', other)]);
    expect(first?.issues).toEqual([
      expect.objectContaining({ code: 'aliasIsModuleId', path: 'aliases[1]', line: 3 }),
    ]);
    expect(second?.issues).toEqual([]);
  });

  it('allows the same search alias on several modules', () => {
    const results = validateModules([
      file('demo', demo.replace('name: Demo', 'name: Demo\naliases: [suite]')),
      file('other', other.replace('name: Other', 'name: Other\naliases: [suite]')),
    ]);
    expect(results.flatMap((r) => r.issues)).toEqual([]);
  });
});
