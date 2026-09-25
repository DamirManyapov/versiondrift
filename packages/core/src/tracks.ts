import type { Module } from '@versiondrift/schema';
import { normalizeVersion } from './version.ts';

const compiled = new WeakMap<object, { id: string; match: RegExp }[]>();

/** Id of the first track whose `match` regex matches the version, or null (docs/05). */
export function trackOf(module: Pick<Module, 'tracks'>, raw: string): string | null {
  const tracks = module.tracks;
  if (!tracks?.length) return null;
  let list = compiled.get(tracks);
  if (!list) {
    list = tracks.map((t) => ({ id: t.id, match: new RegExp(t.match) }));
    compiled.set(tracks, list);
  }
  const version = normalizeVersion(raw);
  return list.find((t) => t.match.test(version))?.id ?? null;
}
