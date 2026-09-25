/** One version scheme. `P` is the parsed form; callers only see it through `Version`. */
export interface SchemeImpl<P> {
  parse(raw: string): P | null;
  /** Negative, zero or positive. */
  compare(a: P, b: P): number;
  /** Byte-wise sortable string: key(a) < key(b) exactly when compare(a, b) < 0. */
  sortKey(p: P): string;
  branch(p: P): string;
}
