import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFetcher,
  fetchAdvisories,
  fetchKev,
  fixtureFetch,
  parseRangeExpression,
  severityFromScore,
  type AdapterContext,
} from '../src/index.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const ctx = (dir: string): AdapterContext => ({
  fetcher: createFetcher({ fetch: fixtureFetch(path.join(FIXTURES, dir)), sleep: () => Promise.resolve() }),
  log: { info() {}, warn() {} },
  knownVersions: new Set(),
});

describe('ghsa: repository advisories without a CVE', () => {
  it('uses the GHSA id when cve_id is empty', async () => {
    const advisory = {
      ghsa_id: 'GHSA-3h96-x359-qrwm',
      cve_id: '',
      summary: 'Multiple security issues in dovecot ',
      severity: 'high',
      published_at: '2020-08-22T19:47:23Z',
      html_url: 'https://github.com/Mailu/Mailu/security/advisories/GHSA-3h96-x359-qrwm',
      vulnerabilities: [
        { vulnerable_version_range: '< 1.7', patched_versions: '', first_patched_version: '' },
      ],
    };
    const context: AdapterContext = {
      fetcher: createFetcher({
        fetch: () => Promise.resolve(Response.json([advisory])),
        sleep: () => Promise.resolve(),
      }),
      log: { info() {}, warn() {} },
      knownVersions: new Set(),
    };
    const [result] = await fetchAdvisories({ type: 'ghsa', repo: 'Mailu/Mailu' }, context);
    expect(result).toMatchObject({
      id: 'GHSA-3h96-x359-qrwm',
      aliases: [],
      title: 'Multiple security issues in dovecot',
      affected: [{ introduced: '0', fixed: '1.7' }],
    });
  });
});

describe('parseRangeExpression', () => {
  it.each([
    ['>= 1.0.0, < 1.2.3', undefined, [{ introduced: '1.0.0', fixed: '1.2.3' }]],
    ['< 2.0', undefined, [{ introduced: '0', fixed: '2.0' }]],
    ['<= 2.0', undefined, [{ introduced: '0', last_affected: '2.0' }]],
    ['= 1.4.2', undefined, [{ introduced: '1.4.2', last_affected: '1.4.2' }]],
    ['1.0.0 - 2.0.0', undefined, [{ introduced: '1.0.0', last_affected: '2.0.0' }]],
    [
      '>=9.2.0 <9.2.10 >=9.3.0 <9.3.4',
      undefined,
      [
        { introduced: '9.2.0', fixed: '9.2.10' },
        { introduced: '9.3.0', fixed: '9.3.4' },
      ],
    ],
    ['>= v5.0.0-beta1', '9.1.8', [{ introduced: '5.0.0-beta1', fixed: '9.1.8' }]],
    ['<9.x, <8.x', undefined, []],
  ])('%s (patched %s)', (expression, patched, expected) => {
    expect(parseRangeExpression(expression, patched)).toEqual(expected);
  });

  it('builds per-branch ranges from several patched versions, keeping unpatched branches affected', () => {
    expect(parseRangeExpression('6.3.0-beta1 - 9.3.1', '9.3.2, 9.2.8, 8.5.16')).toEqual([
      { introduced: '6.3.0-beta1', fixed: '8.5.16' },
      { introduced: '8.6.0', fixed: '9.2.0' },
      { introduced: '9.2.0', fixed: '9.2.8' },
      { introduced: '9.3.0', fixed: '9.3.2' },
    ]);
  });
});

describe('severityFromScore', () => {
  it('maps CVSS scores and falls back to the vendor rating', () => {
    expect([9.8, 7.0, 4.0, 0.1, 0].map((s) => severityFromScore(s))).toEqual([
      'critical',
      'high',
      'medium',
      'low',
      'unknown',
    ]);
    expect(severityFromScore(null, 'high')).toBe('high');
  });
});

describe('advisory sources', () => {
  it('ghsa: repository advisories with CVE ids, GHSA aliases, CVSS and ranges', async () => {
    const list = await fetchAdvisories({ type: 'ghsa', repo: 'grafana/grafana' }, ctx('ghsa'));
    expect(list).toHaveLength(10);
    expect(list[0]).toMatchObject({
      id: 'CVE-2023-22462',
      aliases: ['GHSA-7rqg-hjwc-6mjf'],
      severity: 'medium',
      cvss: { score: 6.4 },
      source: 'ghsa',
      affected: [
        { introduced: '9.2.0', fixed: '9.2.10' },
        { introduced: '9.3.0', fixed: '9.3.4' },
      ],
    });
  });

  it('nvd: CVSS from the best metric and ranges from the CPE configurations', async () => {
    const list = await fetchAdvisories({ type: 'nvd', cpe: 'cpe:2.3:a:grafana:grafana' }, ctx('nvd'));
    const cve = list.find((a) => a.id === 'CVE-2018-15727');
    expect(cve).toMatchObject({
      severity: 'critical',
      cvss: { score: 9.8 },
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2018-15727',
    });
    expect(cve?.affected).toContainEqual({ introduced: '5.0.0', fixed: '5.2.3' });
    expect(cve?.affected).toContainEqual({ introduced: '2.0.0', last_affected: '2.1.2' });
  });

  it('osv: OSV events become ranges; the CVE alias becomes the id', async () => {
    const list = await fetchAdvisories({ type: 'osv', ecosystem: 'npm', package: 'minimist' }, ctx('osv'));
    const cve = list.find((a) => a.id === 'CVE-2021-44906');
    expect(cve?.aliases).toContain('GHSA-xvch-5gv4-984h');
    expect(cve?.affected).toContainEqual({ introduced: '1.0.0', fixed: '1.2.6' });
  });

  it('kev: the set of known exploited CVE ids', async () => {
    const kev = await fetchKev(ctx('kev').fetcher);
    expect(kev.size).toBe(10);
    expect(kev.has('CVE-2026-67279')).toBe(true);
  });
});

describe('rangesFromConfigurations', async () => {
  const { rangesFromConfigurations } = await import('../src/index.ts');
  it('ignores bounds that are dates, not versions (NVD data quirk)', () => {
    const cve = {
      id: 'CVE-2021-3014',
      published: '',
      descriptions: [],
      configurations: [
        {
          nodes: [
            {
              cpeMatch: [
                {
                  vulnerable: true,
                  criteria: 'cpe:2.3:o:mikrotik:routeros:*:*:*:*:*:*:*:*',
                  versionEndIncluding: '2021-01-04',
                },
                { vulnerable: true, criteria: 'cpe:2.3:o:mikrotik:routeros:6.48:*:*:*:*:*:*:*' },
              ],
            },
          ],
        },
      ],
    };
    expect(rangesFromConfigurations(cve, 'cpe:2.3:o:mikrotik:routeros')).toEqual([
      { introduced: '6.48', last_affected: '6.48' },
    ]);
  });

  it('drops ranges repeated by several editions of one product', () => {
    const edition = (e: string) => ({
      vulnerable: true,
      criteria: `cpe:2.3:a:gitlab:gitlab:*:*:*:*:${e}:*:*:*`,
      versionStartIncluding: '18.7.0',
      versionEndExcluding: '18.11.12',
    });
    const cve = {
      id: 'CVE-2026-0001',
      published: '',
      descriptions: [],
      configurations: [{ nodes: [{ cpeMatch: [edition('community'), edition('enterprise')] }] }],
    };
    expect(rangesFromConfigurations(cve, 'cpe:2.3:a:gitlab:gitlab')).toEqual([
      { introduced: '18.7.0', fixed: '18.11.12' },
    ]);
  });
});
