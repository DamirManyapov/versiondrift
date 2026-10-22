import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changelogSections,
  createFetcher,
  debianAnnouncement,
  extractVersion,
  fetchLifecycle,
  fetchNotes,
  parseDebianChangelog,
  parseZabbixChangelog,
  fetchReleases,
  fixtureFetch,
  microsoftKb,
  notesUrl,
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

  it('drops the release body with notesFrom: none (an announcement, not the changes)', async () => {
    const releases = await fetchReleases(
      { type: 'github', repo: 'grafana/grafana', notesFrom: 'none' },
      ctx('github'),
    );
    expect(releases).toHaveLength(10);
    expect(releases.every((r) => r.notes === undefined)).toBe(true);
    expect(releases[0]).toMatchObject({ version: 'v13.2.2' });
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

describe('gitea', () => {
  it('reads Forgejo releases from Codeberg, dates converted to UTC', async () => {
    const releases = await fetchReleases(
      { type: 'gitea', host: 'codeberg.org', repo: 'forgejo/forgejo' },
      ctx('gitea'),
    );
    expect(releases).toHaveLength(10);
    expect(releases[0]).toMatchObject({
      version: 'v16.0.5',
      date: '2026-09-17T15:27:32Z',
      url: 'https://codeberg.org/forgejo/forgejo/releases/tag/v16.0.5',
      prerelease: false,
    });
    expect(releases[0]?.notes?.body).toContain('release-notes-published/16.0.5.md');
  });

  it('keeps only tags matching versionRegex', async () => {
    const releases = await fetchReleases(
      { type: 'gitea', host: 'codeberg.org', repo: 'forgejo/forgejo', versionRegex: '^v(15\\.\\d+\\.\\d+)$' },
      ctx('gitea'),
    );
    expect(releases.length).toBeGreaterThan(0);
    expect(releases.every((r) => r.version.startsWith('15.'))).toBe(true);
  });
});

describe('changelog files (Zabbix)', () => {
  it('reads notes per version from a release branch ChangeLog', async () => {
    const releases = await fetchReleases(
      {
        type: 'changelog',
        dialect: 'zabbix',
        url: 'https://raw.githubusercontent.com/zabbix/zabbix/release/7.4/ChangeLog',
      },
      ctx('changelog'),
    );
    expect(releases.length).toBeGreaterThan(2);
    for (const r of releases) expect(r.notes?.body).toMatch(/^(### |- )/m);
  });

  it('turns sections into headings, drops the flag column and gives a final release its rc notes', () => {
    const sep = '-'.repeat(80);
    const text = [
      'Changes for 7.4.15',
      '',
      '7.4.15rc1 was released as 7.4.15 without any changes',
      '',
      sep,
      'Changes for 7.4.15rc1',
      '',
      'New features:',
      '...G...... [ZBXNEXT-1] added a thing (someone)',
      '',
      'Bug fixes:',
      '..F....... [ZBX-2] fixed a bug (someone)',
      '',
      sep,
    ].join('\n');
    const releases = parseZabbixChangelog(text);
    const final = releases.find((r) => r.version === '7.4.15');
    expect(final?.notes?.body).toBe(
      '### New features\n- [ZBXNEXT-1] added a thing (someone)\n\n### Bug fixes\n- [ZBX-2] fixed a bug (someone)',
    );
    expect(releases.find((r) => r.version === '7.4.15rc1')?.notes?.body).toBe(final?.notes?.body);
  });
});

describe('Debian packaging (Proxmox)', () => {
  const PACKAGES =
    'http://download.proxmox.com/debian/pbs/dists/trixie/pbs-no-subscription/binary-amd64/Packages';
  const CHANGELOG = 'https://git.proxmox.com/?p=proxmox-backup.git;a=blob_plain;f=debian/changelog;hb=HEAD';
  const REVISION = '^(\\d+\\.\\d+\\.\\d+)-\\d+$';

  it('lists the versions of one package in an APT index, Debian revision dropped', async () => {
    const releases = await fetchReleases(
      { type: 'apt', url: PACKAGES, package: 'proxmox-backup-server', versionRegex: REVISION },
      ctx('debian'),
    );
    expect(releases.length).toBeGreaterThan(3);
    expect(releases.map((r) => r.version)).toContain('4.2.6');
    expect(releases.every((r) => /^\d+\.\d+\.\d+$/.test(r.version))).toBe(true);
    await expect(
      fetchReleases({ type: 'apt', url: PACKAGES, package: 'no-such-package' }, ctx('debian')),
    ).rejects.toThrow(/no package "no-such-package"/);
  });

  it('reads notes and dates from debian/changelog', async () => {
    const releases = await fetchReleases(
      { type: 'debian-changelog', url: CHANGELOG, versionRegex: REVISION },
      ctx('debian'),
    );
    const release = releases.find((r) => r.version === '4.2.6');
    expect(release?.date).toMatch(ISO_UTC);
    expect(release?.notes?.format).toBe('markdown');
    expect(release?.notes?.body).toMatch(/^\* /);
  });

  it('parses entries without their signature lines', () => {
    const text = [
      'pve-manager (9.2.20) trixie; urgency=medium',
      '',
      '  * ui: fix the thing.',
      '',
      ' -- Proxmox Support Team <support@proxmox.com>  Thu, 11 Sep 2026 14:10:20 +0200',
      '',
      'pve-manager (9.2.19) trixie; urgency=medium',
      '',
      '  * api: another fix,',
      '    over two lines.',
      '',
      ' -- Proxmox Support Team <support@proxmox.com>  Tue, 09 Sep 2026 09:00:00 +0200',
    ].join('\n');
    expect(parseDebianChangelog(text)).toEqual([
      {
        version: '9.2.20',
        date: '2026-09-11T12:10:20Z',
        notes: { format: 'markdown', body: '* ui: fix the thing.' },
      },
      {
        version: '9.2.19',
        date: '2026-09-09T07:00:00Z',
        notes: { format: 'markdown', body: '* api: another fix,\n  over two lines.' },
      },
    ]);
  });
});

describe('pointer and notes (MikroTik update server)', () => {
  it('reads the version a channel file names, dated by its Unix time', async () => {
    const releases = await fetchReleases(
      { type: 'pointer', url: 'https://upgrade.mikrotik.com/routeros/NEWESTa7.long-term', epoch: true },
      ctx('pointer'),
    );
    expect(releases).toHaveLength(1);
    expect(releases[0]?.version).toBe('7.23.7');
    expect(releases[0]?.date).toMatch(/^2026-09-1\dT\d{2}:\d{2}:\d{2}Z$/);
  });

  it('fetches notes per version, with the date from the first line in either format', async () => {
    const source = {
      type: 'notes' as const,
      url: 'https://upgrade.mikrotik.com/routeros/{version}/CHANGELOG',
    };
    const patch = await fetchNotes(source, '7.23.7', ctx('pointer'));
    expect(patch).toMatchObject({ notes: { format: 'text' }, date: '2026-09-16T00:00:00Z' });
    expect(patch?.notes.body).toContain('*) lte');
    const minor = await fetchNotes(source, '7.24', ctx('pointer'));
    expect(minor?.date).toBe('2026-08-14T00:00:00Z');
    expect(await fetchNotes(source, '7.0.99', ctx('pointer'))).toBeUndefined();
  });

  it("reads the release's own page for {url}, and nothing without one", async () => {
    const fetcher = createFetcher({
      fetch: (url) => Promise.resolve(new Response(`notes from ${url}`)),
      sleep: () => Promise.resolve(),
    });
    const source = { type: 'notes' as const, url: '{url}' };
    const patch = await fetchNotes(source, '13.7', { fetcher }, 'https://x.test/news/13.7');
    expect(patch?.notes.body).toBe('notes from https://x.test/news/13.7');
    expect(await fetchNotes(source, '13.7', { fetcher })).toBeUndefined();
  });

  it('fills {major}, {minor}, {patch} and {build} from the version', () => {
    expect(
      notesUrl(
        'https://dev.mysql.com/doc/relnotes/mysql/{major}.{minor}/en/news-{major}-{minor}-{patch}.html',
        '8.4.6',
      ),
    ).toBe('https://dev.mysql.com/doc/relnotes/mysql/8.4/en/news-8-4-6.html');
    expect(notesUrl('https://x.test/{major}.{minor}/{major}.{minor}.{patch}-{build}.html', '8.4.6-6.1')).toBe(
      'https://x.test/8.4/8.4.6-6.html',
    );
  });

  it('takes the selected part of a page, without self-links, dated by its opening', async () => {
    const page = `<nav><ul><li>Home</li></ul></nav><div id="docContent"><h2>Release 18.1 <a href="#r">#</a></h2>
      <p>Release date: 2025-11-13</p><ul><li><p>Check for CREATE privileges <a href="#x">§</a> (CVE-2025-12817)</p></li></ul></div>`;
    const fetcher = createFetcher({
      fetch: () => Promise.resolve(new Response(page)),
      sleep: () => Promise.resolve(),
    });
    const patch = await fetchNotes(
      { type: 'notes', url: 'https://x.test/{version}/', select: '#docContent' },
      '18.1',
      { fetcher },
    );
    expect(patch?.date).toBe('2025-11-13T00:00:00Z');
    expect(patch?.notes.format).toBe('html');
    expect(patch?.notes.body).not.toMatch(/Home|§|>#</);
    expect(patch?.notes.body).toContain('Check for CREATE privileges');
    expect(
      await fetchNotes({ type: 'notes', url: 'https://x.test/{version}/', select: '#missing' }, '18.1', {
        fetcher,
      }),
    ).toBeUndefined();
  });

  it('refuses notes as a primary source', async () => {
    await expect(
      fetchReleases({ type: 'notes', url: 'https://example.test/{version}' }, ctx('pointer')),
    ).rejects.toThrow(/releasesExtra/);
  });
});

describe('Debian point release announcements', () => {
  const row = (a: string, b: string) => `<tr><td><a href="#">${a}</a></td>\n  <td>${b}</td></tr>`;
  const page = (security: [string, string][]) => `<h2>Miscellaneous Bugfixes</h2><p>…</p>
    <table><tr><th>Package</th><th>Reason</th></tr>
    ${row('alsa-lib', 'Fix heap overflow issue [CVE-2026-25068]')}
    ${row('at-spi2-core', 'Fix atkversion.h header\n  for C++ linkage')}</table>
    <h2>Security Updates</h2><table><tr><th>Advisory ID</th><th>Package</th></tr>
    ${security.map(([a, b]) => row(a, b)).join('')}</table>
    <h2>Removed packages</h2><table>${row('oldpkg', 'Unmaintained')}</table>`;

  it('turns the tables into one security line and a bug fix per package', () => {
    const markdown = debianAnnouncement(
      page([
        ['DSA-6381', 'linux-signed-amd64'],
        ['DSA-6381', 'linux'],
        ['DSA-6382', 'postfix'],
      ]),
    );
    expect(markdown).toBe(
      [
        '### Security updates',
        '- 2 security advisories included: DSA-6381 linux-signed-amd64 +1, DSA-6382 postfix',
        '',
        '### Bug fixes',
        '- alsa-lib: Fix heap overflow issue [CVE-2026-25068]',
        '- at-spi2-core: Fix atkversion.h header for C++ linkage',
      ].join('\n'),
    );
  });

  it('shortens a long advisory list at a comma', () => {
    const many = Array.from({ length: 60 }, (_, i): [string, string] => [`DSA-${6000 + i}`, 'chromium']);
    const line = debianAnnouncement(page(many)).split('\n')[1] ?? '';
    expect(line.length).toBeLessThanOrEqual(300);
    expect(line).toMatch(/^- 60 security advisories included: DSA-6000 chromium, .*chromium, …$/);
  });

  it('is empty for a page without the tables', () => {
    expect(debianAnnouncement('<h1>Debian 13 released</h1><p>…</p>')).toBe('');
  });
});

describe('Microsoft KB articles', () => {
  const page = (heading: string) => `<h1>September 8, 2026—KB5122876 (OS Build 17763.9245)</h1>
    <h2>${heading}</h2><p>Applies to:</p><ul><li>Windows Server 2019</li><li>Windows 10, version 1809</li></ul>
    <p>This security update includes fixes that are part of the following update:</p>
    <ul><li><a href="#">August 11, 2026—KB5120238 (OS Build 17763.9121)</a></li></ul>
    <ul><li><p>[Secure Boot] This update includes additional device targeting data.</p></li>
      <li>[Sysmon]<ul><li>Fixed: This update addresses an issue that caused crashes.</li></ul></li></ul>
    <p>See the Security Update Guide and <a href="#">September 2026 Security Updates</a>.</p>
    <h3>Known issues in this update</h3><ul><li>Remote Desktop might become unstable after this update.</li></ul>
    <h2>How to get this update</h2><ul><li>Windows Update: Yes</li></ul>`;

  it('keeps the change bullets and turns the security updates link into a first line', () => {
    const expected = [
      '- Security update: includes the September 2026 Security Updates',
      '- [Secure Boot] This update includes additional device targeting data.',
      '- Fixed: This update addresses an issue that caused crashes.',
    ].join('\n');
    expect(microsoftKb(page('Summary'))).toBe(expected);
    expect(microsoftKb(page('Improvements'))).toBe(expected);
  });

  it('is empty without a summary', () => {
    expect(microsoftKb('<h1>KB</h1><h2>File information</h2><ul><li>a file.dll</li></ul>')).toBe('');
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

  it('dates a release by its link when neither title nor body has a date (Debian news)', () => {
    const news = `<p><tt>[12 Sep 2026]</tt> <strong><a href="./20260912">Updated Debian 13: 13.7 released</a></strong></p>
      <p><strong><a href="./20260708">Updated Debian 12: 12.15 released</a></strong></p>`;
    const releases = parseHtmlReleases(news, {
      type: 'html',
      url: 'https://www.debian.org/News/2026/',
      select: { item: 'strong', body: 'script' },
      versionRegex: 'Updated Debian \\d+: (\\d+\\.\\d+) released',
      dateFormat: 'YYYYMMDD',
    });
    expect(releases).toEqual([
      expect.objectContaining({
        version: '13.7',
        date: '2026-09-12T00:00:00Z',
        url: 'https://www.debian.org/News/2026/20260912',
      }),
      expect.objectContaining({ version: '12.15', date: '2026-07-08T00:00:00Z' }),
    ]);
  });

  it('reads a table row as its cells joined by " | " (build number tables)', () => {
    const table = `<table>
      <tr><th>Version</th><th>Release Name</th><th>Release Date</th><th>Build Number</th></tr>
      <tr><td>ESXi 8.0.3 EP6</td><td><a href="/notes/80u3k.html">ESXi 8.0 Update 3k</a></td><td>2026/07/29</td><td>25595708</td></tr>
      <tr><td>ESX 8.0.0g</td><td><a href="/notes/80g.html">ESXi 8.0g</a></td><td>2026/02/13</td><td>25191479</td></tr>
      <tr><td>ESXi 6.7 P08</td><td>ESXi670-202210001</td><td>2022/10/06</td><td>20497097</td></tr>
    </table>`;
    const releases = parseHtmlReleases(table, {
      type: 'html',
      url: 'https://kb.test/316595',
      select: { item: 'tr', body: 'script' },
      versionRegex: '^ESXi? ((?:[7-9]|[1-9]\\d)\\.\\d+(?:\\.\\d+){0,2})[a-z]?\\b.* \\| (\\d{7,9})$',
      versionFormat: '$1-$2',
      dateFormat: 'YYYY/MM/DD',
    });
    expect(releases).toEqual([
      {
        version: '8.0.3-25595708',
        title: 'ESXi 8.0.3 EP6 | ESXi 8.0 Update 3k | 2026/07/29 | 25595708',
        url: 'https://kb.test/notes/80u3k.html',
        date: '2026-07-29T00:00:00Z',
      },
      expect.objectContaining({ version: '8.0.0-25191479', date: '2026-02-13T00:00:00Z' }),
    ]);
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

  it('renames cycles to the version prefix they cover and leaves the others out (Windows Server)', async () => {
    const cycle = (name: string, eolFrom: string, latest: string) => ({
      name,
      codename: null,
      releaseDate: null,
      isLts: true,
      isEol: false,
      eolFrom,
      latest: { name: latest, date: null },
    });
    const body = JSON.stringify({
      result: {
        releases: [
          cycle('2022', '2031-10-14', '10.0.20348'),
          cycle('1809-sac', '2020-11-10', '10.0.17763'),
          cycle('2019', '2029-01-09', '10.0.17763'),
        ],
      },
    });
    const fetcher = createFetcher({
      fetch: () => Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } })),
      sleep: () => Promise.resolve(),
    });
    const branches = await fetchLifecycle(
      { type: 'endoflife', product: 'windows-server', cycles: { '2022': '20348', '2019': '17763' } },
      { fetcher, log: { info() {}, warn() {} }, knownVersions: new Set() },
    );
    expect(branches.map((b) => [b.name, b.codename, b.eolDate])).toEqual([
      ['20348', '2022', '2031-10-14'],
      ['17763', '2019', '2029-01-09'],
    ]);
  });

  it('as a release source: the latest release of every cycle, dated at midnight UTC', async () => {
    const releases = await fetchReleases({ type: 'endoflife', product: 'debian' }, ctx('endoflife'));
    expect(releases[0]).toMatchObject({
      version: '13.7',
      date: '2026-09-12T00:00:00Z',
      url: 'https://www.debian.org/News/2026/20260912',
    });
    expect(releases.map((r) => r.version)).toContain('12.15');
    expect(new Set(releases.map((r) => r.version)).size).toBe(releases.length);
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

  it('builds the version from several groups with a versionFormat', () => {
    expect(
      extractVersion('ESXi 8.0.3 EP6 | 2026/07/29 | 25595708', '^ESXi (\\S+) .* (\\d{8})$', '$1-$2'),
    ).toBe('8.0.3-25595708');
    expect(extractVersion('nothing here', '^ESXi (\\S+) .* (\\d{8})$', '$1-$2')).toBeUndefined();
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
