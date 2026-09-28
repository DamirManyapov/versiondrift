import type { Advisory } from '@versiondrift/schema';

/** An advisory as one source reports it; the collector merges them by CVE id and aliases. */
export type RawAdvisory = Advisory;
export type AffectedRange = Advisory['affected'][number];
export type Severity = Advisory['severity'];

/** docs/03: critical ≥ 9, high ≥ 7, medium ≥ 4, low > 0. */
export function severityFromScore(
  score: number | undefined | null,
  fallback: Severity = 'unknown',
): Severity {
  if (score === undefined || score === null) return fallback;
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return fallback;
}

export function normalizeSeverity(value: string | null | undefined): Severity {
  const v = (value ?? '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low') return v;
  if (v === 'moderate') return 'medium';
  return 'unknown';
}

const WILDCARD = /[x*+]/i;

function comparatorRanges(expression: string): AffectedRange[] {
  const ranges: AffectedRange[] = [];
  for (const part of expression.split('||')) {
    const hyphen = /^\s*(\d\S*)\s+-\s+(\d\S*)\s*$/.exec(part);
    if (hyphen) {
      ranges.push({ introduced: hyphen[1]!, last_affected: hyphen[2]! });
      continue;
    }
    let current: AffectedRange | undefined;
    const close = () => {
      if (current) ranges.push(current);
      current = undefined;
    };
    for (const [, op, version] of part.matchAll(/(>=|<=|>|<|=)\s*v?([^\s,|]+)/g)) {
      if (!version || WILDCARD.test(version)) continue; // "<9.x", "<= 9.+": no usable bound
      if (op === '>=' || op === '>') {
        close();
        current = { introduced: version };
      } else if (op === '<') {
        current = { introduced: current?.introduced ?? '0', fixed: version };
        close();
      } else if (op === '<=') {
        current = { introduced: current?.introduced ?? '0', last_affected: version };
        close();
      } else {
        close();
        ranges.push({ introduced: version, last_affected: version });
      }
    }
    close();
  }
  return ranges;
}

const numeric = (v: string) => (v.match(/\d+/g) ?? []).map(Number);
function compareLoose(a: string, b: string): number {
  const x = numeric(a);
  const y = numeric(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
const branchStart = (v: string) => `${numeric(v)[0] ?? 0}.${numeric(v)[1] ?? 0}.0`;
const nextBranchStart = (v: string) => `${numeric(v)[0] ?? 0}.${(numeric(v)[1] ?? 0) + 1}.0`;

/**
 * GitHub / npm-style range expressions → OSV ranges: ">= 1.0, < 1.2.3", "<= 2.0", "= 1.4", "1.0 - 2.0",
 * ">=9.2.0 <9.2.10 >=9.3.0 <9.3.4", "a || b". Vendors often give an open or fuzzy range plus one patched version per
 * branch ("9.3.2, 9.2.8, 8.5.16"): then each patched branch is affected from its start up to the fix, and branches in
 * between without a fix (usually end of life) stay affected.
 */
export function parseRangeExpression(expression: string, patched?: string): AffectedRange[] {
  const ranges = comparatorRanges(expression);
  // "9.3.2, 9.2.8", or with operators as GitHub writes some (">= 23.0.3, >= 20.10.24").
  const fixes = (patched ?? '')
    .split(',')
    .map((s) =>
      s
        .trim()
        .replace(/^(>=|=)\s*/, '')
        .replace(/^v/, ''),
    )
    .filter((v) => /^\d/.test(v) && !WILDCARD.test(v))
    .sort(compareLoose);
  const open = ranges.some((r) => r.fixed === undefined && r.last_affected === undefined);
  if (fixes.length === 0 || (!open && !(fixes.length > 1 && ranges.length === 1))) return ranges;

  const lower = ranges.map((r) => r.introduced ?? '0').sort(compareLoose)[0] ?? '0';
  const out: AffectedRange[] = [];
  fixes.forEach((fix, i) => {
    if (i === 0) {
      out.push({ introduced: lower, fixed: fix });
      return;
    }
    const gapStart = nextBranchStart(fixes[i - 1]!);
    const start = branchStart(fix);
    if (compareLoose(gapStart, start) < 0) out.push({ introduced: gapStart, fixed: start });
    out.push({ introduced: start, fixed: fix });
  });
  return out;
}
