import { describe, expect, it } from 'vitest';
import { branchOf, parse } from '../src/index.ts';
import { expectAscending, expectEqual } from './helpers.ts';

describe('debian', () => {
  it('follows the Debian Policy example: ~~ < ~~a < ~ < (none) < a', () => {
    expectAscending('debian', ['1.0~~', '1.0~~a', '1.0~', '1.0', '1.0a']);
  });

  it('sorts letters before other characters, and ~ before the end', () => {
    expectAscending('debian', ['1.0~rc1', '1.0', '1.0a', '1.0+b1', '1.0.1']);
    expectAscending('debian', ['1A', '1Z', '1a', '1z', '1+', '1.']);
  });

  it('compares epoch first, then upstream, then revision', () => {
    expectAscending('debian', [
      '2.3.4-1',
      '2.3.4-1+deb12u1',
      '2.3.4-1+deb12u2',
      '2.3.4-2',
      '2.3.5-1',
      '1:0.1',
    ]);
    expectAscending('debian', ['12.7', '12.8', '12.10', '13.0', '13.1']);
  });

  it('keeps hyphens inside the upstream version', () => {
    expectAscending('debian', ['1.2-3-1', '1.2-3-2', '1.2-4-1']);
    expect(parse('debian', '1.2-3-1')).not.toBeNull();
  });

  it('treats equal-valued spellings as equal', () => {
    expectEqual('debian', '1.01', '1.1');
    expectEqual('debian', '0:1.0', '1.0');
    expectEqual('debian', '1.0', '1.0-0');
    expectEqual('debian', '1.0-1', '1.0-01');
  });

  it.each(['', 'a1.0', '1.0-', ':1.0', 'x:1.0', '1.0-a_b', '1.0 1', '1.0-rev-'])('rejects %j', (raw) =>
    expect(parse('debian', raw)).toBeNull(),
  );

  it('branch is the major version, with the epoch when set', () => {
    expect(branchOf('debian', '12.7')).toBe('12');
    expect(branchOf('debian', '1:2.3.4-1+deb12u1')).toBe('1:2');
  });
});
