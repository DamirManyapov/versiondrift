// Semantic Versioning 2.0.0 (https://semver.org) after stripping "v", with one extension from docs/05:
// a purely numeric suffix ("8.0.36-28") is the vendor's build number, i.e. a 4th numeric segment that sorts
// after the plain version, not a pre-release that sorts before it.
import { compareDigits, compareStrings, digitsKey, MAX_DIGITS, type Digits } from '../digits.ts';
import type { SchemeImpl } from './types.ts';

const NUM = '0|[1-9]\\d*';
const PRE_ID = `(?:${NUM}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(
  `^(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

type Identifier = { num: Digits } | { text: string };

export interface SemverParts {
  /** major, minor, patch, build ("0" when absent). */
  core: [Digits, Digits, Digits, Digits];
  /** Pre-release identifiers; null for a release. */
  pre: Identifier[] | null;
  branch: string;
}

function compareIdentifiers(a: Identifier, b: Identifier): number {
  if ('num' in a) return 'num' in b ? compareDigits(a.num, b.num) : -1; // numeric < alphanumeric
  return 'num' in b ? 1 : compareStrings(a.text, b.text);
}

export const semver: SchemeImpl<SemverParts> = {
  parse(raw) {
    const m = SEMVER.exec(raw);
    if (!m) return null;
    const [, major = '', minor = '', patch = '', pre] = m;
    let build = '0';
    let identifiers: Identifier[] | null = null;
    if (pre !== undefined && /^\d+$/.test(pre)) build = pre;
    else if (pre !== undefined)
      identifiers = pre.split('.').map((id) => (/^\d+$/.test(id) ? { num: id } : { text: id }));
    const core: SemverParts['core'] = [major, minor, patch, build];
    const numbers = [...core, ...(identifiers ?? []).flatMap((id) => ('num' in id ? [id.num] : []))];
    if (numbers.some((d) => d.length > MAX_DIGITS)) return null;
    return { core, pre: identifiers, branch: `${major}.${minor}` };
  },

  compare(a, b) {
    for (let i = 0; i < 4; i++) {
      const c = compareDigits(a.core[i] ?? '0', b.core[i] ?? '0');
      if (c !== 0) return c;
    }
    if (a.pre === null || b.pre === null) return (a.pre === null ? 1 : 0) - (b.pre === null ? 1 : 0);
    for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
      const c = compareIdentifiers(a.pre[i]!, b.pre[i]!);
      if (c !== 0) return c;
    }
    return a.pre.length - b.pre.length;
  },

  // core numbers, then "~" for a release or "-" + identifiers + "!" for a pre-release ("-" < "~").
  // Identifiers: "1" + number key, or "2" + text + "!" ("!" sorts below every identifier character).
  sortKey(p) {
    const core = p.core.map(digitsKey).join('');
    if (p.pre === null) return `${core}~`;
    const ids = p.pre.map((id) => ('num' in id ? `1${digitsKey(id.num)}` : `2${id.text}!`)).join('');
    return `${core}-${ids}!`;
  },

  branch: (p) => p.branch,
};
