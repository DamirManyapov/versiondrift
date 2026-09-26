import { normalizeVersion } from './version.ts';

/** A track as the feed carries it (docs/05): its regex, and whether pre-releases count in it. */
export interface TrackRule {
  id: string;
  /** Absent only in a module's pointer tracks before the collector resolves them; such tracks match nothing. */
  match?: string | undefined;
  prereleases?: boolean | undefined;
}

const LATEST = 'latest';
const compiled = new WeakMap<object, { id: string; match: RegExp | null; prereleases: boolean }[]>();

function rules(tracks: readonly TrackRule[]) {
  let list = compiled.get(tracks);
  if (!list) {
    list = tracks.map((t) => ({
      id: t.id,
      match: t.match === undefined ? null : new RegExp(t.match),
      prereleases: t.prereleases === true,
    }));
    compiled.set(tracks, list);
  }
  return list;
}

/** Id of the first track whose `match` regex matches the version, or null — the track a version suggests. */
export function trackOf(product: { tracks?: readonly TrackRule[] | undefined }, raw: string): string | null {
  if (!product.tracks?.length) return null;
  const version = normalizeVersion(raw);
  return rules(product.tracks).find((t) => t.match?.test(version))?.id ?? null;
}

/**
 * Whether a release belongs to a track. Tracks may overlap (MikroTik: 7.23.x is in "long-term" and in "stable"),
 * so membership is the track's own rule, not the one track a release was first filed under.
 */
export function inTrack(
  product: { tracks?: readonly TrackRule[] | undefined },
  trackId: string,
  release: { version: string; prerelease: boolean },
): boolean {
  if (trackId === LATEST) return !release.prerelease;
  const rule = product.tracks?.length ? rules(product.tracks).find((t) => t.id === trackId) : undefined;
  if (!rule?.match) return false;
  if (release.prerelease && !rule.prereleases) return false;
  return rule.match.test(normalizeVersion(release.version));
}

/** Whether the product defines this track (or it is "latest"). */
export const isTrack = (product: { tracks?: readonly TrackRule[] | undefined }, trackId: string) =>
  trackId === LATEST || (product.tracks ?? []).some((t) => t.id === trackId);
