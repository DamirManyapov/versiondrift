import { describe, expect, it } from 'vitest';
import { Module, type ModuleInput, unwrapUnions } from '../src/index.ts';

const minimal: ModuleInput = {
  id: 'demo',
  name: 'Demo',
  category: 'other',
  versionScheme: 'semver',
  sources: { releases: { type: 'github', repo: 'acme/demo' } },
};

const withFields = (fields: Record<string, unknown>) => ({ ...minimal, ...fields });
const withSource = (key: string, value: unknown) =>
  withFields({ sources: { ...minimal.sources, [key]: value } });

function issuesOf(input: unknown): { path: string; message: string }[] {
  const result = Module.safeParse(input);
  if (result.success) return [];
  // What `pnpm modules:validate` reports: unions unwrapped to the branch that fits.
  return unwrapUnions(result.error.issues).map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('Module', () => {
  it('accepts a minimal module and applies defaults', () => {
    const module = Module.parse(minimal);
    expect(module.prerelease).toBe('skip');
    expect(module.defaultTrack).toBe('latest');
  });

  it('accepts every source and detector kind', () => {
    const full = withFields({
      tracks: [
        { id: '2', match: '^2\\.', label: 'LTS' },
        { id: '1', match: '^1\\.' },
      ],
      defaultTrack: '2',
      sources: {
        releases: { type: 'gitlab', project: 'acme/demo' },
        releasesExtra: [
          {
            type: 'github',
            repo: 'acme/demo',
            useTags: true,
            notesFrom: 'changelogFile',
            changelogPath: 'CHANGES.md',
          },
          { type: 'gitea', host: 'codeberg.org', repo: 'acme/demo' },
          {
            type: 'rss',
            url: 'https://acme.example/feed',
            versionFrom: 'title',
            versionRegex: '(\\d+\\.\\d+)',
          },
          { type: 'html', url: 'https://acme.example/changes', select: { item: 'h2', body: 'h2 + ul' } },
          { type: 'dockerhub', repo: 'acme/demo', tagRegex: '^\\d+$' },
          { type: 'manual', file: 'products/demo.releases.yaml' },
        ],
        security: [
          { type: 'osv', ecosystem: 'npm', package: 'demo' },
          { type: 'ghsa', repo: 'acme/demo' },
          { type: 'ghsa', ecosystem: 'npm', package: 'demo' },
          { type: 'nvd', cpe: 'cpe:2.3:a:acme:demo' },
          { type: 'debian', packages: 'fromInventory' },
          { type: 'debian', packages: ['openssl'] },
          { type: 'rss', url: 'https://acme.example/security.rss' },
        ],
        eol: { type: 'endoflife', product: 'demo' },
      },
      classify: { sections: { security: ['Security'] }, keywords: { breaking: ['removed'] } },
      detect: [
        { http: { path: '/api/version', jsonPath: '$.version', defaultPort: 8080, scheme: 'https' } },
        { docker: { image: 'acme/demo' } },
        { command: { run: 'demo -v', regex: 'v(\\S+)' } },
        { file: { path: '/etc/demo-release' } },
        { snmp: { oid: '1.3.6.1.2.1.1.1.0' } },
        { sql: { engine: 'mysql', query: 'SELECT VERSION()' } },
      ],
      maintainers: ['@octocat'],
    });
    expect(issuesOf(full)).toEqual([]);
  });

  it.each([
    ['unknown key', withFields({ colour: 'red' }), '', 'Unrecognized key: "colour"'],
    ['bad id', withFields({ id: 'My_Product' }), 'id', 'lowercase kebab-case'],
    ['unknown category', withFields({ category: 'games' }), 'category', 'Invalid option'],
    ['long description', withFields({ description: 'x'.repeat(201) }), 'description', 'Too big'],
    ['non-http homepage', withFields({ homepage: 'ftp://acme.example' }), 'homepage', 'Invalid URL'],
    ['regex scheme without versionRegex', withFields({ versionScheme: 'regex' }), 'versionRegex', 'required'],
    ['branchGroups without regex scheme', withFields({ branchGroups: 2 }), 'branchGroups', 'only used with'],
    [
      'invalid regex',
      withFields({ tagFilter: { include: '(\\d+' } }),
      'tagFilter.include',
      'Invalid regular',
    ],
    ['numeric track id', withFields({ tracks: [{ id: 12, match: '^12' }] }), 'tracks.0.id', 'quote numbers'],
    [
      'duplicate track id',
      withFields({
        tracks: [
          { id: '1', match: '^1' },
          { id: '1', match: '^1\\.' },
        ],
      }),
      'tracks.1.id',
      'duplicate track id',
    ],
    ['reserved track id', withFields({ tracks: [{ id: 'latest', match: '.' }] }), 'tracks.0.id', 'reserved'],
    ['unknown defaultTrack', withFields({ defaultTrack: '9' }), 'defaultTrack', 'not a track id'],
    [
      'unknown source type',
      withSource('releases', { type: 'svn', url: 'x' }),
      'sources.releases.type',
      'unknown source type',
    ],
    [
      'bad github repo',
      withSource('releases', { type: 'github', repo: 'demo' }),
      'sources.releases.repo',
      'owner/name',
    ],
    [
      'extra key in a source',
      withSource('releases', { type: 'github', repo: 'acme/demo', branch: 'main' }),
      'sources.releases',
      'Unrecognized key: "branch"',
    ],
    [
      'ghsa with both forms',
      withSource('security', [{ type: 'ghsa', repo: 'acme/demo', ecosystem: 'npm', package: 'demo' }]),
      'sources.security.0',
      'set either repo, or ecosystem + package',
    ],
    [
      'ghsa without package',
      withSource('security', [{ type: 'ghsa', ecosystem: 'npm' }]),
      'sources.security.0',
      'set either repo, or ecosystem + package',
    ],
    [
      'bad cpe',
      withSource('security', [{ type: 'nvd', cpe: 'grafana' }]),
      'sources.security.0.cpe',
      'CPE 2.3',
    ],
    [
      'two detectors in one item',
      withFields({ detect: [{ docker: { image: 'a/b' }, file: { path: '/x' } }] }),
      'detect.0',
      'exactly one of',
    ],
    ['empty detect item', withFields({ detect: [{}] }), 'detect.0', 'exactly one of'],
    [
      'relative http path',
      withFields({ detect: [{ http: { path: 'api' } }] }),
      'detect.0.http.path',
      'start with /',
    ],
  ])('rejects %s', (_, input, path, message) => {
    const issues = issuesOf(input);
    expect(issues.map((i) => i.path)).toContain(path);
    expect(issues.find((i) => i.path === path)?.message).toContain(message);
  });
});

describe('Inventory', async () => {
  const { Inventory, inventoryEntries } = await import('../src/index.ts');
  it('accepts lists, single instances and a version shorthand', () => {
    const inv = Inventory.parse({
      boards: {
        prod: {
          products: {
            grafana: [{ version: '12.4.5', host: 'mon-01' }, { version: '13.2.1' }],
            'poste-io': '2.5.17',
          },
        },
        lab: { products: { zabbix: { version: '7.0.30', track: '7.0' } } },
      },
    });
    expect(inventoryEntries(inv)).toEqual([
      {
        board: 'prod',
        productId: 'grafana',
        instances: [{ version: '12.4.5', host: 'mon-01' }, { version: '13.2.1' }],
      },
      { board: 'prod', productId: 'poste-io', instances: [{ version: '2.5.17' }] },
      { board: 'lab', productId: 'zabbix', instances: [{ version: '7.0.30', track: '7.0' }] },
    ]);
  });

  it('rejects unquoted numeric versions, which YAML would corrupt (12.10 → 12.1)', () => {
    const result = Inventory.safeParse({ boards: { prod: { products: { debian: 12.1 } } } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('quote versions');
  });
});

describe('update channels and several release sources', () => {
  const channelTrack = {
    id: 'long-term',
    current: { url: 'https://upgrade.mikrotik.com/routeros/NEWESTa7.long-term' },
  };

  it('accepts pointer tracks, a list of release sources and notes templates', () => {
    const input = withFields({
      tracks: [
        channelTrack,
        { id: 'stable', match: '^7\\.' },
        { id: 'testing', match: '^7\\.', prereleases: true },
      ],
      sources: {
        releases: [
          { type: 'rss', url: 'https://mikrotik.com/current.rss' },
          { type: 'pointer', url: 'https://upgrade.mikrotik.com/routeros/NEWESTa7.stable', epoch: true },
        ],
        releasesExtra: [{ type: 'notes', url: 'https://upgrade.mikrotik.com/routeros/{version}/CHANGELOG' }],
      },
    });
    expect(issuesOf(input)).toEqual([]);
  });

  it.each([
    [
      'a track with neither rule',
      withFields({ tracks: [{ id: 'x' }] }),
      'tracks.0',
      'exactly one of match or current',
    ],
    [
      'a track with both rules',
      withFields({ tracks: [{ ...channelTrack, match: '^7' }] }),
      'tracks.0',
      'exactly one of match or current',
    ],
    [
      'notes as a primary source',
      withSource('releases', [{ type: 'notes', url: 'https://x.test/{version}' }]),
      'sources.releases.0.type',
      'use it in releasesExtra',
    ],
    [
      'a notes URL without {version}',
      withSource('releasesExtra', [{ type: 'notes', url: 'https://x.test/CHANGELOG' }]),
      'sources.releasesExtra.0.url',
      'containing {version}',
    ],
    ['an empty list of release sources', withSource('releases', []), 'sources.releases', ''],
  ])('rejects %s', (_, input, path, message) => {
    const issues = issuesOf(input);
    expect(issues.map((i) => i.path)).toContain(path);
    expect(issues.find((i) => i.path === path)?.message).toContain(message);
  });
});
