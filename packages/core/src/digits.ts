// Version numbers are kept as digit strings, so arbitrarily long build numbers compare exactly without BigInt.

/** A non-negative integer as a digit string without leading zeros ("0" for zero). */
export type Digits = string;

/** Longest number a version segment may have; longer strings are not versions. */
export const MAX_DIGITS = 26;

export function toDigits(run: string): Digits {
  const trimmed = run.replace(/^0+/, '');
  return trimmed === '' ? '0' : trimmed;
}

export function compareDigits(a: Digits, b: Digits): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Order-preserving, self-delimiting key for a number: "`" for zero, otherwise a letter giving the digit count
 * (a = 1 … z = 26) followed by the digits. "9" → "a9" sorts before "10" → "b10".
 */
export function digitsKey(d: Digits): string {
  return d === '0' ? '`' : String.fromCharCode(96 + d.length) + d;
}

export function sign(n: number): -1 | 0 | 1 {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
