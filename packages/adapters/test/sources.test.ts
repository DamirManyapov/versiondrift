import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changelogSections,
  createFetcher,
  extractVersion,
  fetchLifecycle,
  fetchReleases,
  fixtureFetch,
  parseDate,
  parseHtmlReleases,
  SourceError,
  type AdapterContext,
  type FetchFn,
} from '../src/index.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

function ctx(fixtures: string, extra: Partial<AdapterContext> = {}): AdapterContext {
  const fetcher = createFetcher({
    fetch: fixtureFetch(path.join(FIXTURES, fixtures)),
    sleep: () => Promise.resolve(),
  });
  return { fetcher, log: { info() {}, warn() {} }, knownVersions: new Set(), ...extra };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe('github', () => {
  it('reads releases with Markdown notes and the pre-release flag', async () => {
    const releases = await fetchReleases({ type: 'github', repo: 'grafana/grafana' }, ctx('github'));
    expect(releases).toHaveLength(10);
    const [latest] = releases;
    expect(latest).toMatchObject({
      version: 'v13.2.2',
      prerelease: false,
      url: 'https://github.com/grafana/grafana/releases/tag/v13.2.2',
    });
    expect(latest?.date).toMatch(ISO_UTC);
    expect(latest?.notes?.format).toBe('markdown');
    expect(latest?.notes?.body).toContain('### Security');
  });

  it('reads tags with dates via GraphQL, in UTC', async () => {
    const tags = await fetchReleases({ type: 'github', repo: 'zabbix/zabbix', useTags: true }, ctx('github'));
    expect(tags).toHaveLength(10);
    expect(tags[0]).toMatchObject({
      version: '7.4.15',
      url: 'https://github.com/zabbix/zabbix/releases/tag/7.4.15',
    });
    for (const tag of tags) expect(tag.date).toMatch(ISO_UTC);
  });

  it('stops paging once a page contains a known version', async () => {
    const urls: string[] = [];
    const page = (n: number) =>
      Array.from({ length: 100 }, (_, i) => ({
        tag_name: `v1.${n}.${i}`,
        published_at: '2026-01-01T00:00:00Z',
        html_url: '',
        prerelease: false,
        draft: false,
        body: null,
        name: null,
        created_at: '',
      }));
    const fetch: FetchFn = (url) => {
      urls.push(url);
      return Promise.resolve(Response.json(page(Number(new URL(url).searchParams.get('page')))));
    };
    const fetcher = createFetcher({ fetch, sleep: () => Promise.resolve() });
    const releases = await fetchReleases(
      { type: 'github', repo: 'a/b' },
      { fetcher, log: console, knownVersions: new Set(['v1.2.50']) },
    );
    expect(urls).toHaveLength(2);
    expect(releases).toHaveLength(200);
  });

  it('splits a changelog file into sections per version heading', () => {
    const sections = changelogSections(
      [
        '# Changelog',
        '',
        '## v2.0.0 (2026-01-02)',
        '### Breaking',
        '- removed x',
        '',
        '## 1.9.1',
        '- fix y',
        '# Older',
        'text',
      ].join('\n'),
    );
    expect(sections.get('2.0.0')).toBe('### Breaking\n- removed x');
    expect(sections.get('1.9.1')).toBe('- fix y');
  });
});

describe('rss', () => {
  it('reads RSS 1.0 (RDF) and keeps only entries that name a version', async () => {
    const releases = await fetchReleases(
      {
        type: 'rss',
        url: 'https://www.debian.org/News/news',
        versionFrom: 'title',
        versionRegex: 'Debian (\\d+\\.\\d+) released|Updated Debian \\d+: (\\d+\\.\\d+) released',
      },
      ctx('rss'),
    );
    expect(releases.map((r) => r.version)).toEqual(['13.7', '12.15', '13.6']);
    expect(releases[0]).toMatchObject({
      url: 'https://www.debian.org/News/2026/20260912',
      date: '2026-09-12T00:00:00Z',
    });
  });

  it('reads RSS 2.0 with content:encoded', async () => {
    const [release] = await fetchReleases(
      {
        type: 'rss',
        url: 'https://mikrotik.com/current.rss',
        versionFrom: 'title',
        versionRegex: 'RouterOS (\\d+\\.\\d+(?:\\.\\d+)?) \\[stable\\]',
      },
      ctx('rss'),
    );
    expect(release).toMatchObject({ version: '7.24.4', date: '2026-09-16T15:34:02Z' });
    expect(release?.notes?.body).toContain("What's new in 7.24.4");
  });

  it('reads Atom', async () => {
    const releases = await fetchReleases(
      { type: 'rss', url: 'https://github.com/grafana/grafana/releases.atom', versionFrom: 'title' },
      ctx('rss'),
    );
    expect(releases).toHaveLength(10);
    expect(releases[0]).toMatchObject({
      version: '13.2.2',
      url: 'https://github.com/grafana/grafana/releases/tag/v13.2.2',
    });
  });
});

describe('html', () => {
  it('reads a heading-per-release changelog, with the date in the heading', async () => {
    const releases = await fetchReleases(
      {
        type: 'html',
        url: 'https://poste.io/changelog',
        select: { item: 'h2' },
        versionRegex: '(\\d+\\.\\d+\\.\\d+)',
        dateFormat: 'YYYYMMDD',
      },
      ctx('html'),
    );
    expect(releases.length).toBeGreaterThan(100);
    expect(releases[0]).toMatchObject({ version: '2.5.17', date: '2026-09-18T00:00:00Z' });
    expect(releases[0]?.notes?.body).toMatch(/^<ul>/);
    expect(releases[0]?.notes?.body).not.toContain('2.5.16');
  });

  const page = `<main>
    <article id="r3"><h3><a href="/notes/3.0">Version 3.0</a></h3><time datetime="2026-03-01">March 1</time><ul><li>new</li></ul></article>
    <article id="r2"><h3>Version 2.9</h3><span class="d">5 February 2026</span><p>fixes</p></article>
    <article><h3>Roadmap</h3></article>
  </main>`;
  const source = {
    type: 'html',
    url: 'https://x.test/changes',
    select: { item: 'article', title: 'h3', date: 'time, .d', body: 'ul, p' },
  } as const;

  it('looks up title, date and body inside each item, and resolves links', () => {
    const releases = parseHtmlReleases(page, { ...source, dateFormat: 'D MMM YYYY' });
    expect(releases.map((r) => r.version)).toEqual(['3.0', '2.9']);
    expect(releases[0]).toMatchObject({ url: 'https://x.test/notes/3.0', date: '2026-03-01T00:00:00Z' });
    expect(releases[1]).toMatchObject({ url: 'https://x.test/changes#r2', date: '2026-02-05T00:00:00Z' });
    expect(releases[1]?.notes?.body).toBe('<p>fixes</p>');
  });

  it('fails loudly when the item selector matches nothing', () => {
    expect(() => parseHtmlReleases(page, { ...source, select: { item: 'section' } })).toThrow(SourceError);
  });
});

describe('dockerhub', () => {
  it('reads tags that match tagRegex', async () => {
    const releases = await fetchReleases(
      { type: 'dockerhub', repo: 'analogic/poste.io', tagRegex: '^\\d+\\.\\d+\\.\\d+$' },
      ctx('dockerhub'),
    );
    expect(releases.length).toBeGreaterThan(0);
    for (const r of releases) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(ISO_UTC);
      expect(r.url).toBe(`https://hub.docker.com/r/analogic/poste.io/tags?name=${r.version}`);
    }
  });
});

describe('endoflife', () => {
  it('maps release cycles to branches', async () => {
    const branches = await fetchLifecycle({ type: 'endoflife', product: 'debian' }, ctx('endoflife'));
    const trixie = branches.find((b) => b.name === '13');
    expect(trixie).toMatchObject({ codename: 'Trixie', eol: false, lts: false });
    expect(trixie?.eolDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(branches.find((b) => b.name === '10')).toMatchObject({ eol: true });
  });
});

describe('manual', () => {
  const files: Record<string, string> = {
    'products/x.releases.yaml':
      '- version: "1.2"\n  date: 2026-05-01\n  notes: "- fixed"\n- version: "1.1"\n',
    'products/x.eol.yaml': '- name: "1"\n  eolDate: 2000-01-01\n- name: "2"\n  lts: true\n',
    'products/bad.yaml': '- version: 1.2\n',
  };
  const readRepoFile = (p: string) => Promise.resolve(files[p] ?? '');

  it('reads releases and branches from repository files', async () => {
    const releases = await fetchReleases(
      { type: 'manual', file: 'products/x.releases.yaml' },
      ctx('none', { readRepoFile }),
    );
    expect(releases).toEqual([
      { version: '1.2', date: '2026-05-01T00:00:00Z', notes: { format: 'markdown', body: '- fixed' } },
      { version: '1.1' },
    ]);
    const branches = await fetchLifecycle(
      { type: 'manual', file: 'products/x.eol.yaml' },
      ctx('none', { readRepoFile }),
    );
    expect(branches).toEqual([
      { name: '1', eol: true, eolDate: '2000-01-01', lts: false },
      { name: '2', eol: false, lts: true },
    ]);
  });

  it('requires quoted versions (YAML would turn 1.10 into 1.1)', async () => {
    await expect(
      fetchReleases({ type: 'manual', file: 'products/bad.yaml' }, ctx('none', { readRepoFile })),
    ).rejects.toThrow(/quoted/);
  });
});

describe('extractVersion', () => {
  it('takes the first non-empty group, or a version-looking token by default', () => {
    expect(
      extractVersion(
        'Updated Debian 12: 12.15 released',
        'Debian (\\d+\\.\\d+) released|Updated Debian \\d+: (\\d+\\.\\d+) released',
      ),
    ).toBe('12.15');
    expect(extractVersion('RouterOS 7.24.4 [stable]')).toBe('7.24.4');
    expect(extractVersion('Security announcement')).toBeUndefined();
  });
});

describe('parseDate', () => {
  it.each([
    ['2.5.17 - 20260918', 'YYYYMMDD', '2026-09-18T00:00:00Z'],
    ['Released March 5, 2026', 'MMM D, YYYY', '2026-03-05T00:00:00Z'],
    ['05.03.2026', 'DD.MM.YYYY', '2026-03-05T00:00:00Z'],
    ['on 2026-03-05', undefined, '2026-03-05T00:00:00Z'],
    ['2026-03-05 14:30:00+02:00', undefined, '2026-03-05T12:30:00Z'],
  ])('%s (%s)', (text, format, expected) => expect(parseDate(text, format)).toBe(expected));

  it('does not guess dates from version numbers or invalid days', () => {
    expect(parseDate('2.5.17')).toBeUndefined();
    expect(parseDate('20260231', 'YYYYMMDD')).toBeUndefined();
  });
});

describe('html: wrappers and body dates', () => {
  it('treats an element that only wraps a heading as a heading, and finds the date in the body', () => {
    const page = `<article>
      <div class="heading-wrapper" id="r-9-5-4"><h2><a href="#r-9-5-4">9.5.4</a></h2></div>
      <div class="heading-wrapper"><h3>Fixes</h3></div><ul><li>fixed a crash</li></ul>
      <div class="heading-wrapper" id="r-9-5-3"><h2>9.5.3</h2></div><p>Released 05. August 2026</p><ul><li>other</li></ul>
      <h2><span class="mw-headline" id="Proxmox_VE_9.2">Proxmox VE 9.2</span></h2><p>Released 21. May 2026</p>
    </article>`;
    const wrapped = parseHtmlReleases(page, {
      type: 'html',
      url: 'https://x.test/notes',
      select: { item: 'div.heading-wrapper:has(> h2)' },
      dateFormat: 'DD. MMM YYYY',
    });
    expect(wrapped.map((r) => r.version)).toEqual(['9.5.4', '9.5.3']);
    expect(wrapped[0]).toMatchObject({ url: 'https://x.test/notes#r-9-5-4' });
    expect(wrapped[0]?.notes?.body).toContain('fixed a crash');
    expect(wrapped[0]?.notes?.body).not.toContain('9.5.3');
    expect(wrapped[1]).toMatchObject({ date: '2026-08-05T00:00:00Z' });

    const [pve] = parseHtmlReleases(page, {
      type: 'html',
      url: 'https://x.test/wiki',
      select: { item: 'h2:has(.mw-headline)' },
      versionRegex: '^Proxmox VE (\\d+\\.\\d+)$',
      dateFormat: 'DD. MMM YYYY',
    });
    expect(pve).toMatchObject({
      version: '9.2',
      date: '2026-05-21T00:00:00Z',
      url: 'https://x.test/wiki#Proxmox_VE_9.2',
    });
  });

  it('applies versionRegex to GitHub tags and skips tags that do not match', async () => {
    const fetch: FetchFn = () =>
      Promise.resolve(
        Response.json([
          {
            tag_name: 'release-1.31.6',
            published_at: '2026-09-15T00:00:00Z',
            html_url: '',
            prerelease: false,
            draft: false,
            body: null,
            name: null,
            created_at: '',
          },
          {
            tag_name: 'nightly',
            published_at: '2026-09-14T00:00:00Z',
            html_url: '',
            prerelease: false,
            draft: false,
            body: null,
            name: null,
            created_at: '',
          },
        ]),
      );
    const fetcher = createFetcher({ fetch, sleep: () => Promise.resolve() });
    const releases = await fetchReleases(
      { type: 'github', repo: 'nginx/nginx', versionRegex: '^release-(\\d+\\.\\d+\\.\\d+)$' },
      { fetcher, log: console, knownVersions: new Set() },
    );
    expect(releases.map((r) => r.version)).toEqual(['1.31.6']);
  });
});
