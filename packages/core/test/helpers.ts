import { expect } from 'vitest';
import { compare, parse, type SchemeSpec } from '../src/index.ts';

/** Every version is strictly greater than the ones before it, by compare() and by sortKey. */
export function expectAscending(spec: SchemeSpec, versions: string[]): void {
  const parsed = versions.map((raw) => {
    const v = parse(spec, raw);
    expect(v, `parse ${raw}`).not.toBeNull();
    return v!;
  });
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const [a, b] = [parsed[i]!, parsed[j]!];
      expect(compare(spec, a, b), `${a.raw} < ${b.raw}`).toBe(-1);
      expect(compare(spec, b, a), `${b.raw} > ${a.raw}`).toBe(1);
      expect(a.sortKey < b.sortKey, `sortKey ${a.raw} < ${b.raw}`).toBe(true);
    }
  }
}

export function expectEqual(spec: SchemeSpec, a: string, b: string): void {
  expect(compare(spec, a, b), `${a} == ${b}`).toBe(0);
  expect(parse(spec, a)?.sortKey).toBe(parse(spec, b)?.sortKey);
}
