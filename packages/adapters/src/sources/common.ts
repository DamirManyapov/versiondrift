import type { RawRelease } from '../types.ts';

type SourceType<T extends { type: string }, K extends string> = Extract<T, { type: K }>;
export type { SourceType };

/** Dotted numbers with an optional "v" and "-suffix": v2.0.0, 12.15, 8.0.36-28, 2.0.0-beta.1. */
const DEFAULT_VERSION = /(?<![\w.])v?(\d+(?:\.\d+)+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)/;

/** Applies a module's versionRegex: the first non-empty capture group wins, or the whole match without groups. */
export function extractVersion(text: string, versionRegex?: string): string | undefined {
  const m = (versionRegex ? new RegExp(versionRegex) : DEFAULT_VERSION).exec(text);
  if (!m) return undefined;
  return m.slice(1).find((g) => g !== undefined && g !== '') ?? (m.length === 1 ? m[0] : undefined);
}

/** Replaces tag names with the version a source's versionRegex extracts; tags without a match are dropped. */
export function withVersionRegex(releases: RawRelease[], versionRegex: string | undefined): RawRelease[] {
  if (!versionRegex) return releases;
  return releases.flatMap((r) => {
    const version = extractVersion(r.version, versionRegex);
    return version === undefined ? [] : [{ ...r, version }];
  });
}

/** True once a page reaches versions the previous feed already has, or releases older than `since`. */
export function reachedKnown(page: RawRelease[], known: ReadonlySet<string>, since?: Date): boolean {
  if (page.some((r) => known.has(r.version))) return true;
  if (since && page.length > 0 && page.every((r) => r.date !== undefined && new Date(r.date) < since))
    return true;
  return false;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Finds a date in free text and returns it as ISO 8601 UTC (midnight for date-only).
 * `format` uses YYYY, MM, M, DD, D, MMM (month name, any length ≥ 3); without it only ISO dates are found —
 * never Date.parse on free text, which reads "2.5.17" as 5 Feb 2017.
 */
export function parseDate(text: string, format?: string): string | undefined {
  if (format) {
    const order: string[] = [];
    const pattern = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/YYYY|MMM|MM|M|DD|D/g, (token) => {
      order.push(token);
      return token === 'YYYY'
        ? '(\\d{4})'
        : token === 'MMM'
          ? '([A-Za-z]{3,})'
          : token.length === 2
            ? '(\\d{2})'
            : '(\\d{1,2})';
    });
    const m = new RegExp(pattern).exec(text);
    if (!m) return undefined;
    const parts: Record<string, string> = {};
    order.forEach(
      (token, i) => (parts[token[0] === 'Y' ? 'y' : token[0] === 'D' ? 'd' : 'm'] = m[i + 1] ?? ''),
    );
    const month = /^\d+$/.test(parts.m ?? '')
      ? Number(parts.m)
      : MONTHS.indexOf((parts.m ?? '').slice(0, 3).toLowerCase()) + 1;
    return isoDate(Number(parts.y), month, Number(parts.d));
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:?\d{2})?)?/.exec(text);
  if (iso) {
    if (iso[4]) {
      const parsed = Date.parse(iso[0].replace(' ', 'T') + (iso[5] ? '' : 'Z'));
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  return undefined;
}

function isoDate(y: number, m: number, d: number): string | undefined {
  if (!(y > 1970 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return undefined;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Normalizes any date string a source gives (RFC 822, ISO with offset…) to ISO 8601 UTC. */
export function toIso(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
