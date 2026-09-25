// docs/05: compare is a total order and sortKey order equals compare order, for every scheme.
// Small alphabets make equal and near-equal versions frequent, which is where orderings break.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compare, parse, type SchemeSpec, type Version } from '../src/index.ts';

const smallNumber = fc.integer({ min: 0, max: 12 }).map(String);
const number = fc.oneof(
  { weight: 6, arbitrary: smallNumber },
  { weight: 1, arbitrary: fc.bigInt({ min: 0n, max: 10n ** 24n }).map(String) },
);
const zeroPadded = fc.tuple(fc.constantFrom('', '', '0', '00'), number).map(([pad, n]) => pad + n);

const semverString = fc
  .record({
    v: fc.constantFrom('', 'v'),
    core: fc.tuple(number, number, number),
    pre: fc.option(
      fc.array(fc.oneof(smallNumber, fc.constantFrom('alpha', 'beta', 'rc', 'rc1', 'rc10', 'RC', 'x-1')), {
        minLength: 1,
        maxLength: 3,
      }),
    ),
    build: fc.option(fc.constantFrom('b1', 'build.7', 'sha-1f2e')),
  })
  .map(
    ({ v, core, pre, build }) =>
      `${v}${core.join('.')}${pre ? `-${pre.join('.')}` : ''}${build ? `+${build}` : ''}`,
  );

// Numbers are always separated (by a separator or a text atom): adjacent digits would merge into one number.
const looseAtom = fc.oneof(
  fc.tuple(fc.constantFrom('.', '.', '-', '_', '+'), zeroPadded).map(([sep, n]) => sep + n),
  fc
    .tuple(fc.constantFrom('.', '-', ''), fc.constantFrom('rc', 'beta', 'a', 'RC'))
    .map(([sep, text]) => sep + text),
);
const looseString = fc
  .tuple(zeroPadded, fc.array(looseAtom, { maxLength: 5 }))
  .map(([first, rest]) => first + rest.join(''));

// Non-digit runs between the numbers, from characters where Debian ordering is subtle.
const debianRun = fc
  .array(fc.constantFrom('.', '+', '~', '~', 'a', 'b', 'Z'), { minLength: 1, maxLength: 3 })
  .map((cs) => cs.join(''));
const debianPart = fc
  .tuple(zeroPadded, fc.array(fc.tuple(debianRun, zeroPadded), { maxLength: 3 }), fc.option(debianRun))
  .map(([head, pairs, tail]) => head + pairs.map(([run, n]) => run + n).join('') + (tail ?? ''));
const debianString = fc
  .record({
    epoch: fc.option(fc.constantFrom('0', '1', '2', '10', '01')),
    upstream: debianPart,
    revision: fc.option(debianPart),
  })
  .map(
    ({ epoch, upstream, revision }) =>
      `${epoch !== null ? `${epoch}:` : ''}${upstream}${revision !== null ? `-${revision}` : ''}`,
  );

const regexModule = { versionScheme: 'regex' as const, versionRegex: '^(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?$' };
const regexString = fc
  .tuple(zeroPadded, fc.array(zeroPadded, { maxLength: 2 }))
  .map(([first, rest]) => [first, ...rest].join('.'));

const cases: [string, SchemeSpec, fc.Arbitrary<string>][] = [
  ['semver', 'semver', semverString],
  ['loose', 'loose', looseString],
  ['calver', 'calver', looseString],
  ['debian', 'debian', debianString],
  ['regex', regexModule, regexString],
];

const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe.each(cases)('%s', (_, spec, strings) => {
  const versions = strings.map((raw) => {
    const v = parse(spec, raw);
    if (v === null) throw new Error(`generator produced an invalid version: ${raw}`);
    return v;
  });
  const cmp = (a: Version, b: Version) => compare(spec, a, b);

  it('parses every generated version', () => {
    fc.assert(fc.property(strings, (raw) => parse(spec, raw) !== null));
  });

  it('compare is reflexive and antisymmetric', () => {
    fc.assert(
      fc.property(versions, versions, (a, b) => {
        expect(cmp(a, a)).toBe(0);
        expect(cmp(a, b)).toBe(-cmp(b, a) || 0);
      }),
      { numRuns: 2000 },
    );
  });

  it('compare is transitive', () => {
    fc.assert(
      fc.property(versions, versions, versions, (a, b, c) => {
        if (cmp(a, b) <= 0 && cmp(b, c) <= 0) expect(cmp(a, c)).toBeLessThanOrEqual(0);
      }),
      { numRuns: 2000 },
    );
  });

  it('sortKey order equals compare order', () => {
    fc.assert(
      fc.property(versions, versions, (a, b) => {
        expect(byteOrder(a.sortKey, b.sortKey)).toBe(cmp(a, b));
      }),
      { numRuns: 5000 },
    );
  });
});
