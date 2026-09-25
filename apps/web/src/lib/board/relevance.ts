// How a release shipped this week relates to what the user runs (docs/06 "This week").
import { parse, trackOf } from '@versiondrift/core';
import type { FeedProduct } from '@versiondrift/schema';
import type { InventoryItem } from '../inventory/model.ts';

export type Relevance = 'affectsYouSecurity' | 'affectsYou' | 'installed' | 'otherTrack' | 'notOnBoard';

export function relevanceOf(
  product: FeedProduct | undefined,
  version: string,
  hasSecurity: boolean,
  instances: InventoryItem[],
): Relevance {
  if (instances.length === 0 || !product) return 'notOnBoard';
  const release = parse(product, version);
  if (!release) return 'notOnBoard';
  let result: Relevance = 'otherTrack';
  for (const item of instances) {
    const installed = item.ver ? parse(product, item.ver) : null;
    if (!installed) continue;
    const track = item.track ?? trackOf(product, installed.raw) ?? product.defaultTrack;
    const sameTrack = track === 'latest' || trackOf(product, release.raw) === track;
    if (!sameTrack) continue;
    if (release.sortKey > installed.sortKey) return hasSecurity ? 'affectsYouSecurity' : 'affectsYou';
    result = 'installed';
  }
  return result;
}
