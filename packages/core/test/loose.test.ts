import { describe, expect, it } from 'vitest';
import { branchOf, parse } from '../src/index.ts';
import { expectAscending, expectEqual } from './helpers.ts';

describe('loose', () => {
  it('compares numbers numerically, segment by segment', () => {
    expectAscending('loose', [
      '2.5.2',
      '5.7.44',
      '5.7.44-31.65',
      '5.7.44-31.66',
      '5.7.45',
      '7.9',
      '7.19.4',
      '7.20',
    ]);
  });

  it('sorts a text suffix before the plain version', () => {
    expectAscending('loose', ['7.20beta4', '7.20rc1', '7.20rc2', '7.20', '7.20.1']);
    expectAscending('loose', ['1.0-alpha', '1.0-beta', '1.0-rc1', '1.0', '1.0-1']);
  });

  it('treats missing segments as 0, and ignores case, leading zeros and separator style', () => {
    expectEqual('loose', '1.0', '1.0.0');
    expectEqual('loose', '1.0', '1');
    expectEqual('loose', '1.0-RC1', '1.0.rc.1');
    expectEqual('loose', '2026.09', '2026.9');
    expectEqual('loose', 'v7.19', '7.19');
  });

  it('keeps zeros in the middle significant', () => {
    expectAscending('loose', ['1.0.0.rc', '1', '1.0.0.5', '1.0.3', '1.1']);
  });

  it.each(['', 'latest', 'beta1', '-1.0', '1.2.123456789012345678901234567'])('rejects %j', (raw) =>
    expect(parse('loose', raw)).toBeNull(),
  );

  it('branch is the first two numbers as written', () => {
    expect(branchOf('loose', '8.0.36-28')).toBe('8.0');
    expect(branchOf('loose', '12')).toBe('12.0');
    expect(branchOf('loose', '7.20rc1')).toBe('7.20');
    expect(branchOf('calver', '24.04.1')).toBe('24.04');
  });

  it('calver orders like loose', () => {
    expectAscending('calver', ['2024.12', '2025.1', '2025.01.1', '2025.10']);
  });
});
