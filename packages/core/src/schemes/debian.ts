// Debian version ordering, a port of dpkg's verrevcmp (lib/dpkg/version.c; Debian Policy §5.6.12):
// [epoch:]upstream[-revision]. Strings compare as alternating non-digit and digit runs; in non-digit runs
// "~" sorts before everything (even the end), then the end, then letters, then all other characters;
// digit runs compare numerically. So 1.0~rc1 < 1.0 < 1.0a < 1.0+b1, and 1.01 == 1.1.
import { compareDigits, digitsKey, MAX_DIGITS, toDigits, type Digits } from '../digits.ts';
import type { SchemeImpl } from './types.ts';

export interface DebianParts {
  epoch: Digits;
  upstream: string;
  /** "" when absent, which dpkg treats like "0". */
  revision: string;
  branch: string;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c: string): boolean => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');

function order(c: string | undefined): number {
  if (c === undefined || isDigit(c)) return 0;
  if (isLetter(c)) return c.charCodeAt(0);
  if (c === '~') return -1;
  return c.charCodeAt(0) + 256;
}

export function verrevcmp(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    let firstDiff = 0;
    while ((i < a.length && !isDigit(a[i])) || (j < b.length && !isDigit(b[j]))) {
      const ac = order(a[i]);
      const bc = order(b[j]);
      if (ac !== bc) return ac - bc;
      i++;
      j++;
    }
    while (a[i] === '0') i++;
    while (b[j] === '0') j++;
    while (isDigit(a[i]) && isDigit(b[j])) {
      if (!firstDiff) firstDiff = a.charCodeAt(i) - b.charCodeAt(j);
      i++;
      j++;
    }
    if (isDigit(a[i])) return 1;
    if (isDigit(b[j])) return -1;
    if (firstDiff) return firstDiff;
  }
  return 0;
}

// Key of one upstream/revision string: for each (non-digit run, digit run) pair, the mapped non-digit characters,
// "%" for the end of the run, and the number's digitsKey; "$" ends the string. Mapped order matches `order`:
// "~"→"#" < "$" (end of string) and "%" (end of run) < letters (as is) < "+"→"{" < "-"→"|" < "."→"}".
const MAPPED: Record<string, string> = { '~': '#', '+': '{', '-': '|', '.': '}' };

function stringKey(s: string): string {
  let key = '';
  let i = 0;
  do {
    for (; i < s.length && !isDigit(s[i]); i++) key += MAPPED[s[i]!] ?? s[i];
    key += '%';
    const start = i;
    while (isDigit(s[i])) i++;
    key += digitsKey(toDigits(s.slice(start, i)));
  } while (i < s.length);
  return `${key}$`;
}

export const debian: SchemeImpl<DebianParts> = {
  parse(raw) {
    let rest = raw;
    let epoch = '0';
    const colon = rest.indexOf(':');
    if (colon >= 0) {
      const e = rest.slice(0, colon);
      if (!/^\d+$/.test(e)) return null;
      epoch = toDigits(e);
      rest = rest.slice(colon + 1);
    }
    let revision = '';
    const dash = rest.lastIndexOf('-');
    if (dash >= 0) {
      revision = rest.slice(dash + 1);
      rest = rest.slice(0, dash);
      if (!/^[A-Za-z0-9.+~]+$/.test(revision)) return null;
    }
    if (!/^[0-9][A-Za-z0-9.+~-]*$/.test(rest)) return null;
    const numbers = [epoch, ...`${rest} ${revision}`.split(/\D+/).filter(Boolean).map(toDigits)];
    if (numbers.some((d) => d.length > MAX_DIGITS)) return null;
    const major = /^\d+/.exec(rest)?.[0] ?? '0';
    return { epoch, upstream: rest, revision, branch: epoch === '0' ? major : `${epoch}:${major}` };
  },

  compare: (a, b) =>
    compareDigits(a.epoch, b.epoch) || verrevcmp(a.upstream, b.upstream) || verrevcmp(a.revision, b.revision),

  sortKey: (p) => digitsKey(p.epoch) + stringKey(p.upstream) + stringKey(p.revision),

  branch: (p) => p.branch,
};
