// Public version API (docs/05-status-engine.md): parse, compare, sortKey, branchOf.
import type { Module, VersionScheme } from '@versiondrift/schema';
import { sign } from './digits.ts';
import { debian } from './schemes/debian.ts';
import { loose } from './schemes/loose.ts';
import { regexScheme } from './schemes/regex.ts';
import { semver } from './schemes/semver.ts';
import type { SchemeImpl } from './schemes/types.ts';

/** A scheme name, or a module; `regex` needs the module because it carries versionRegex/branchGroups. */
export type SchemeSpec =
  VersionScheme | (Pick<Module, 'versionScheme'> & Partial<Pick<Module, 'versionRegex' | 'branchGroups'>>);

export interface Version {
  readonly scheme: VersionScheme;
  /** The input without surrounding whitespace and a leading "v". */
  readonly raw: string;
  /** Sortable as a plain byte string; equal keys mean equal versions. Stored in the feed, opaque otherwise. */
  readonly sortKey: string;
  /** Release branch, e.g. "12.1" (semver), "8.0" (loose), "12" (debian). */
  readonly branch: string;
}

export class InvalidVersionError extends Error {
  override name = 'InvalidVersionError';
}

const FIXED: Record<Exclude<VersionScheme, 'regex'>, SchemeImpl<unknown>> = {
  semver,
  loose,
  calver: loose,
  debian,
};
const regexSchemes = new Map<string, SchemeImpl<unknown>>();

function resolve(spec: SchemeSpec): { name: VersionScheme; impl: SchemeImpl<unknown> } {
  const name = typeof spec === 'string' ? spec : spec.versionScheme;
  if (name !== 'regex') return { name, impl: FIXED[name] };
  if (typeof spec === 'string' || spec.versionRegex === undefined) {
    throw new Error('versionScheme "regex" needs the module (its versionRegex), not just the scheme name');
  }
  const cacheKey = `${spec.branchGroups ?? ''}\u0000${spec.versionRegex}`;
  let impl = regexSchemes.get(cacheKey);
  if (!impl) {
    impl = regexScheme(spec.versionRegex, spec.branchGroups);
    regexSchemes.set(cacheKey, impl);
  }
  return { name, impl };
}

const partsOf = new WeakMap<Version, unknown>();

/** Trims and strips a leading "v" ("v9.1.4" → "9.1.4"), as versions are stored in the feed. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^[vV](?=\d)/, '');
}

export function parse(spec: SchemeSpec, raw: string): Version | null {
  const { name, impl } = resolve(spec);
  const clean = normalizeVersion(raw);
  const parts = impl.parse(clean);
  if (parts === null) return null;
  const version: Version = Object.freeze({
    scheme: name,
    raw: clean,
    sortKey: impl.sortKey(parts),
    branch: impl.branch(parts),
  });
  partsOf.set(version, parts);
  return version;
}

function toVersion(spec: SchemeSpec, name: VersionScheme, v: string | Version): Version {
  if (typeof v !== 'string') {
    if (v.scheme !== name) throw new InvalidVersionError(`"${v.raw}" was parsed as ${v.scheme}, not ${name}`);
    return v;
  }
  const parsed = parse(spec, v);
  if (!parsed) throw new InvalidVersionError(`"${v}" is not a valid ${name} version`);
  return parsed;
}

/** -1, 0 or 1. Throws InvalidVersionError for strings that don't parse under the scheme. */
export function compare(spec: SchemeSpec, a: string | Version, b: string | Version): -1 | 0 | 1 {
  const { name, impl } = resolve(spec);
  const pa = partsOf.get(toVersion(spec, name, a));
  const pb = partsOf.get(toVersion(spec, name, b));
  if (pa === undefined || pb === undefined)
    throw new InvalidVersionError('Version objects must come from parse()');
  return sign(impl.compare(pa, pb));
}

export function sortKey(spec: SchemeSpec, raw: string): string {
  return toVersion(spec, resolve(spec).name, raw).sortKey;
}

export function branchOf(spec: SchemeSpec, raw: string): string {
  return toVersion(spec, resolve(spec).name, raw).branch;
}
