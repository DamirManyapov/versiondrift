import { describe, expect, it } from 'vitest';
import { branchOf, compare, parse } from '../src/index.ts';
import { expectAscending } from './helpers.ts';

const build = { versionScheme: 'regex' as const, versionRegex: '^r(\\d+)(?:u(\\d+))?(?:-b(\\d+))?$' };

describe('regex', () => {
  it('compares the captured numbers as a tuple', () => {
    expectAscending(build, ['r9', 'r9u1', 'r9u1-b3', 'r9u2', 'r10']);
  });

  it('rejects versions the regex does not match', () => {
    expect(parse(build, '9.1')).toBeNull();
  });

  it('builds the branch from branchGroups captures', () => {
    expect(branchOf(build, 'r9u2-b7')).toBe('9.2');
    expect(branchOf({ ...build, branchGroups: 1 }, 'r9u2-b7')).toBe('9');
  });

  it('needs the module, not just the scheme name', () => {
    expect(() => compare('regex', 'r1', 'r2')).toThrow(/versionRegex/);
  });
});
