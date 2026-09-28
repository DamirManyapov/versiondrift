// Line rows of a fleet tile ("12 (bookworm) · 12.12–12.15 → 12.15 · ×7"), oldest line first as in the design.
import { lineRows, type LineRow, type ProductAggregate } from '@versiondrift/core';
import type { FeedProduct } from '@versiondrift/schema';
import type { Translate } from '$lib/i18n';
import { trackName } from '$lib/tracks';

/** Short line names for tile rows: "7 · long-term" rather than "RouterOS 7 · long-term". */
export function shortTrackName(track: FeedProduct['tracks'][number]): string {
  if (track.group) return `${track.group.split(' ').pop() ?? track.group} · ${track.label ?? track.id}`;
  return trackName(track);
}

export interface LineView extends LineRow {
  label: string;
  text: string;
}

export function lineViews(
  t: Translate,
  aggregate: ProductAggregate,
  product: FeedProduct | undefined,
): LineView[] {
  const order = [...(product?.tracks ?? []).map((tr) => tr.id)].reverse();
  return lineRows(aggregate, order).map((row) => {
    const track = product?.tracks.find((tr) => tr.id === row.track);
    const label = track ? shortTrackName(track) : (row.min.split(/[.-]/)[0] ?? row.min);
    const range = row.min === row.max ? row.min : `${row.min}–${row.max}`;
    const text =
      row.status === 'eol'
        ? `${range} · EOL`
        : row.min === row.latest && row.max === row.latest
          ? `${row.latest} · ${t('lineLatest')}`
          : `${range} → ${row.latest ?? '?'}`;
    return { ...row, label, text };
  });
}
