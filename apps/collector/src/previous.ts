// The previous feed (docs/01: the source of truth between runs), from the public URL or a local directory.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFetcher, HttpError, type Logger } from '@versiondrift/adapters';
import {
  FeedIndex,
  FeedProduct,
  Health,
  type FeedIndex as FeedIndexT,
  type FeedProduct as FeedProductT,
  type Health as HealthT,
} from '@versiondrift/schema';
import { sha256 } from './build.ts';

export interface PreviousFeed {
  index?: FeedIndexT;
  health?: HealthT;
  product(id: string): Promise<FeedProductT | undefined>;
}

export const EMPTY_FEED: PreviousFeed = { product: () => Promise.resolve(undefined) };

/** `location` is a URL or directory that contains v1/ (e.g. https://feed.versiondrift.dev or .feed). */
export async function loadPreviousFeed(location: string, log: Logger): Promise<PreviousFeed> {
  const remote = /^https?:\/\//.test(location);
  const fetcher = createFetcher();
  const read = async (file: string): Promise<string | undefined> => {
    try {
      if (remote)
        return (
          await fetcher.text(
            new URL(`v1/${file}`, location.endsWith('/') ? location : `${location}/`).toString(),
          )
        ).body;
      return await readFile(path.join(location, 'v1', file), 'utf8');
    } catch (error) {
      if (error instanceof HttpError && (error.status === 404 || error.status === 403)) return undefined;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };

  const indexText = await read('index.json');
  if (indexText === undefined) {
    log.warn(`no previous feed at ${location}: starting from scratch`);
    return EMPTY_FEED;
  }
  const index = FeedIndex.parse(JSON.parse(indexText));
  const healthText = await read('health.json');
  const health = healthText ? Health.safeParse(JSON.parse(healthText)) : undefined;

  return {
    index,
    ...(health?.success && { health: health.data }),
    async product(id) {
      const entry = index.products[id];
      if (!entry) return undefined;
      const text = await read(remote ? entry.url : entry.url.replace(/\?.*$/, ''));
      if (text === undefined) {
        log.warn(`${id}: previous product file missing`);
        return undefined;
      }
      if (sha256(text) !== entry.sha256)
        log.warn(`${id}: previous product file does not match the index hash`);
      const parsed = FeedProduct.safeParse(JSON.parse(text));
      if (!parsed.success) {
        log.warn(
          `${id}: previous product file is invalid, ignoring it: ${parsed.error.issues[0]?.message ?? ''}`,
        );
        return undefined;
      }
      return parsed.data;
    },
  };
}
