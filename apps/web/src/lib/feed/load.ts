// Shared by the server-rendered pages and feeds: index entry + product file (or 404/502), recent weekly digests.
import { error } from '@sveltejs/kit';
import type { WeekDigest } from '@versiondrift/schema';
import { feedBaseUrl } from '$lib/config';
import { isoWeek, shiftWeek, weekId } from '$lib/week';
import { FeedClient, FeedError } from './client.ts';

export async function loadProduct(fetch: typeof globalThis.fetch, id: string) {
  const client = new FeedClient(feedBaseUrl(), fetch);
  const index = await client.index();
  const entry = index.products[id];
  if (!entry) error(404, `Unknown product "${id}"`);
  try {
    return { entry, product: await client.product(id), generatedAt: index.generatedAt };
  } catch (e) {
    if (e instanceof FeedError) error(502, e.message);
    throw e;
  }
}

/** Search engines and the edge may keep rendered pages for a while; the feed changes once a day. */
export const PAGE_CACHE = { 'cache-control': 'public, max-age=600, stale-while-revalidate=86400' };

/** The weekly digests the feed keeps (the last 12 ISO weeks), newest first; missing weeks are skipped. */
export async function recentDigests(
  client: FeedClient,
  now: Date = new Date(),
  weeks = 12,
): Promise<WeekDigest[]> {
  const current = weekId(isoWeek(now));
  const ids = Array.from({ length: weeks }, (_, i) => shiftWeek(current, -i)).filter(
    (id) => id !== undefined,
  );
  const digests = await Promise.all(ids.map((id) => client.week(id)));
  return digests.filter((d) => d !== undefined);
}
