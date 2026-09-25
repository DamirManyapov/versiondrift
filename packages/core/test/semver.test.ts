import { describe, expect, it } from 'vitest';
import { branchOf, parse } from '../src/index.ts';
import { expectAscending, expectEqual } from './helpers.ts';

describe('semver', () => {
  it('orders pre-releases as in the semver.org spec', () => {
    expectAscending('semver', [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '2.0.0',
      '2.1.0',
      '2.1.1',
      '10.0.0',
    ]);
  });

  it('treats a numeric -N suffix as a 4th segment (vendor build number)', () => {
    expectAscending('semver', [
      '8.0.35',
      '8.0.36-rc1',
      '8.0.36',
      '8.0.36-9',
      '8.0.36-28',
      '8.0.36-100',
      '8.0.37',
    ]);
  });

  it('ignores build metadata and a leading v', () => {
    expectEqual('semver', '1.2.3+build.5', '1.2.3');
    expectEqual('semver', 'v9.1.4', '9.1.4');
  });

  it('compares huge numbers exactly', () => {
    expectAscending('semver', [
      '1.0.99999999999999999998',
      '1.0.99999999999999999999',
      '1.0.100000000000000000000',
    ]);
  });

  it.each(['1.2', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3-01', '1.2.3+', 'latest', '', 'v', '1.2.3 beta'])(
    'rejects %j',
    (raw) => expect(parse('semver', raw)).toBeNull(),
  );

  it('branch is major.minor', () => {
    expect(branchOf('semver', 'v12.1.2')).toBe('12.1');
    expect(branchOf('semver', '8.0.36-28')).toBe('8.0');
  });
});
