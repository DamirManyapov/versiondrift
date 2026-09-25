// versionScheme "regex": the module's versionRegex captures numbers; they compare as a numeric tuple.
// The branch is the first `branchGroups` captures (default 2, like major.minor elsewhere).
import { MAX_DIGITS, toDigits } from '../digits.ts';
import { atomsKey, canonical, compareAtomLists, leadingBranch, type Atom, type AtomParts } from './loose.ts';
import type { SchemeImpl } from './types.ts';

export function regexScheme(versionRegex: string, branchGroups = 2): SchemeImpl<AtomParts> {
  const re = new RegExp(versionRegex);
  return {
    parse(raw) {
      const m = re.exec(raw);
      if (!m || m.length < 2) return null;
      const groups = m.slice(1).map((g) => g ?? '0'); // an optional group that did not match counts as 0
      if (!groups.every((g) => /^\d+$/.test(g))) return null;
      const atoms: Atom[] = groups.map((g) => ({ num: toDigits(g) }));
      if (atoms.some((a) => 'num' in a && a.num.length > MAX_DIGITS)) return null;
      return {
        atoms: canonical(atoms),
        branch: leadingBranch(groups, Math.min(branchGroups, groups.length)),
      };
    },
    compare: (a, b) => compareAtomLists(a.atoms, b.atoms),
    sortKey: (p) => atomsKey(p.atoms),
    branch: (p) => p.branch,
  };
}
