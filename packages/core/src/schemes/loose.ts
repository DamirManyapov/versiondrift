// "loose" and "calver" (docs/05): a version is a sequence of number and text atoms, split on anything that is
// not a letter or digit and on digit/letter boundaries ("7.20rc1" → 7, 20, rc, 1). Numbers compare numerically,
// text lexically (case-insensitive), missing atoms count as 0, and text sorts before any number — so a text
// suffix reads as a pre-release: 1.0-rc1 < 1.0 == 1.0.0 < 1.0.1.
import { compareDigits, compareStrings, digitsKey, MAX_DIGITS, toDigits, type Digits } from '../digits.ts';
import type { SchemeImpl } from './types.ts';

export type Atom = { num: Digits } | { text: string };

export interface AtomParts {
  /** Canonical atoms: trailing zeros removed, so equal versions have equal atoms. */
  atoms: Atom[];
  branch: string;
}

const ZERO: Atom = { num: '0' };

/** Trailing zero numbers change nothing ("1.0" == "1"), so drop them. */
export function canonical(atoms: Atom[]): Atom[] {
  let end = atoms.length;
  while (end > 0) {
    const last = atoms[end - 1]!;
    if (!('num' in last) || last.num !== '0') break;
    end--;
  }
  return atoms.slice(0, end);
}

function compareAtoms(a: Atom, b: Atom): number {
  if ('num' in a) return 'num' in b ? compareDigits(a.num, b.num) : 1; // text < number
  return 'num' in b ? -1 : compareStrings(a.text, b.text);
}

export function compareAtomLists(a: Atom[], b: Atom[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = compareAtoms(a[i] ?? ZERO, b[i] ?? ZERO);
    if (c !== 0) return c;
  }
  return 0;
}

// Tokens, in ascending order: text "#…#" < zero-followed-by-text "$" < end "%" < zero-followed-by-number "&"
// < positive number (digitsKey, starts with a–z). A zero's token depends on the next non-zero atom (there always
// is one after `canonical`), which is what decides a comparison against a shorter version.
export function atomsKey(atoms: Atom[]): string {
  let key = '';
  atoms.forEach((atom, i) => {
    if ('text' in atom) {
      key += `#${atom.text}#`;
    } else if (atom.num !== '0') {
      key += digitsKey(atom.num);
    } else {
      const next = atoms.slice(i + 1).find((a) => !('num' in a) || a.num !== '0');
      key += next !== undefined && 'text' in next ? '$' : '&';
    }
  });
  return `${key}%`;
}

/** First `count` leading numbers as written ("24.04" stays "24.04"), padded with "0". */
export function leadingBranch(numbers: string[], count: number): string {
  const parts = numbers.slice(0, count);
  while (parts.length < count) parts.push('0');
  return parts.join('.');
}

export const loose: SchemeImpl<AtomParts> = {
  parse(raw) {
    const s = raw.toLowerCase();
    if (!/^[0-9]/.test(s)) return null;
    const runs = s.match(/[0-9]+|[a-z]+/g) ?? [];
    const atoms: Atom[] = runs.map((run) => (/^\d/.test(run) ? { num: toDigits(run) } : { text: run }));
    if (atoms.some((a) => 'num' in a && a.num.length > MAX_DIGITS)) return null;
    const leading: string[] = [];
    for (const run of runs) {
      if (!/^\d/.test(run)) break;
      leading.push(run);
    }
    return { atoms: canonical(atoms), branch: leadingBranch(leading, 2) };
  },
  compare: (a, b) => compareAtomLists(a.atoms, b.atoms),
  sortKey: (p) => atomsKey(p.atoms),
  branch: (p) => p.branch,
};
