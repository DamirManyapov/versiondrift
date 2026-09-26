// How a track reads in the UI: "13 (LTS)", "RouterOS 7 · long-term" for an update channel.
import type { FeedProduct } from '@versiondrift/schema';

export const trackName = (track: FeedProduct['tracks'][number]) =>
  track.group
    ? `${track.group} · ${track.label ?? track.id}`
    : `${track.id}${track.label ? ` (${track.label})` : ''}`;
