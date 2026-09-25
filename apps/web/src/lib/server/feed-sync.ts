// Self-hosted feed mirror (docs/07 "Feed sync"): pull the signed public feed into VD_DATA_DIR/feed on start and on the
// VD_FEED_SYNC schedule, and serve it to this instance's browsers at /feed/v1/….
import path from 'node:path';
import { Cron } from 'croner';
import {
  DEFAULT_FEED_URL,
  FEED_PUBLIC_KEY,
  readSyncState,
  syncFeed,
  type SyncState,
} from '@versiondrift/feed';
import { env } from '$env/dynamic/private';

export const feedDir = () => path.join(path.resolve(env.VD_DATA_DIR || './data'), 'feed');

let running: Promise<void> | undefined;
let schedule: Cron | undefined;
let afterSync: (() => Promise<void>) | undefined;

/** One sync at a time; failures are logged and recorded in the sync state, the old mirror stays. */
export function syncNow(log: (line: string) => void = console.log): Promise<void> {
  running ??= syncFeed({
    source: env.VD_FEED_URL || DEFAULT_FEED_URL,
    dir: feedDir(),
    publicKey: env.VD_FEED_PUBKEY || FEED_PUBLIC_KEY,
  })
    .then(({ changed, downloaded, state }) =>
      log(
        changed
          ? `VersionDrift: feed synced (${state.products} products, ${downloaded} updated, generated ${state.generatedAt})`
          : 'VersionDrift: feed unchanged',
      ),
    )
    .catch((error: unknown) =>
      log(`VersionDrift: feed sync failed, keeping the local copy: ${(error as Error).message}`),
    )
    // Notifications run after every sync attempt: the local copy is what they read either way.
    .then(() => afterSync?.())
    .finally(() => (running = undefined));
  return running;
}

/** Called once at server start in self-hosted mode; `then` runs after each sync (notifications). */
export function startFeedSync(then?: () => Promise<void>): void {
  if (schedule) return;
  afterSync = then;
  void syncNow();
  const pattern = env.VD_FEED_SYNC || '0 3 * * *';
  schedule = new Cron(
    pattern,
    { timezone: env.VD_TZ || env.TZ || 'UTC', protect: true },
    () => void syncNow(),
  );
}

export const feedSyncState = (): Promise<SyncState> => readSyncState(feedDir());
