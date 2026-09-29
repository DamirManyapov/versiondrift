// Self-hosted feed mirror (docs/07 "Feed sync"): pull the signed public feed into VD_DATA_DIR/feed on start and on the
// VD_FEED_SYNC schedule, import offline packages (uploaded in Settings, or copied into VD_DATA_DIR/feed-import), and
// serve it to this instance's browsers at /feed/v1/…. With VD_FEED_URL=off there is no network sync, only packages.
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Cron } from 'croner';
import {
  DEFAULT_FEED_URL,
  FEED_PUBLIC_KEY,
  importBundle,
  readSyncState,
  syncFeed,
  type SyncResult,
  type SyncState,
} from '@versiondrift/feed';
import { env } from '$env/dynamic/private';

const dataDir = () => path.resolve(env.VD_DATA_DIR || './data');
export const feedDir = () => path.join(dataDir(), 'feed');
/** Offline packages copied here are imported within a minute (and at every sync). */
export const importDir = () => path.join(dataDir(), 'feed-import');

/** Where the network sync pulls from; null with VD_FEED_URL=off (an instance without Internet: packages only). */
export function feedSource(): string | null {
  const value = (env.VD_FEED_URL ?? '').trim();
  if (value === 'off' || value === 'none') return null;
  return value || DEFAULT_FEED_URL;
}

const publicKey = () => env.VD_FEED_PUBKEY || FEED_PUBLIC_KEY;

// Syncs and imports never overlap: each waits for the one before it.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

let running: Promise<void> | undefined;
let schedule: Cron | undefined;
let afterSync: (() => Promise<void>) | undefined;

const PACKAGE = /\.(tar\.gz|tgz|tar)$/;
/** Files that could not be renamed after their import (a read-only folder): not tried again. */
const handled = new Set<string>();

/** Packages waiting in the import folder; a file changed in the last 10 seconds may still be copying. */
async function waitingPackages(now = Date.now()): Promise<string[]> {
  const names = (await readdir(importDir()).catch(() => [] as string[]))
    .filter((n) => PACKAGE.test(n))
    .sort();
  const ready: string[] = [];
  for (const name of names) {
    const info = await stat(path.join(importDir(), name)).catch(() => undefined);
    if (info?.isFile() && now - info.mtimeMs > 10_000 && !handled.has(`${name}:${info.mtimeMs}`))
      ready.push(name);
  }
  return ready;
}

/** Imports what waits in the folder, oldest name first; each file becomes *.imported or *.refused. */
async function importFolder(log: (line: string) => void): Promise<boolean> {
  let changed = false;
  for (const name of await waitingPackages()) {
    const file = path.join(importDir(), name);
    let outcome = 'imported';
    try {
      const result = await importBundle({
        bytes: await readFile(file),
        dir: feedDir(),
        publicKey: publicKey(),
      });
      changed ||= result.changed;
      log(
        `VersionDrift: feed package ${name}: ${result.changed ? `imported, feed built ${result.state.generatedAt}` : 'this feed is already here'}`,
      );
    } catch (error) {
      outcome = 'refused';
      log(`VersionDrift: feed package ${name} refused: ${(error as Error).message}`);
    }
    await rename(file, `${file}.${outcome}`).catch(async () => {
      const info = await stat(file).catch(() => undefined);
      if (info) handled.add(`${name}:${info.mtimeMs}`);
    });
  }
  return changed;
}

async function networkSync(log: (line: string) => void): Promise<void> {
  const source = feedSource();
  if (!source) return;
  try {
    const { changed, downloaded, state } = await syncFeed({ source, dir: feedDir(), publicKey: publicKey() });
    log(
      changed
        ? `VersionDrift: feed synced (${state.products} products, ${downloaded} updated, generated ${state.generatedAt})`
        : 'VersionDrift: feed unchanged',
    );
  } catch (error) {
    log(`VersionDrift: feed sync failed, keeping the local copy: ${(error as Error).message}`);
  }
}

/** One sync at a time: waiting packages first, then the network; failures are logged, the old mirror stays. */
export function syncNow(log: (line: string) => void = console.log): Promise<void> {
  running ??= exclusive(async () => {
    await importFolder(log);
    await networkSync(log);
  })
    // Notifications run after every sync attempt: the local copy is what they read either way.
    .then(() => afterSync?.())
    .finally(() => (running = undefined));
  return running;
}

/** An uploaded offline package; throws with the reason when it is refused (the mirror stays as it was). */
export async function importPackage(
  bytes: Uint8Array,
  log: (line: string) => void = console.log,
): Promise<SyncResult> {
  const result = await exclusive(() => importBundle({ bytes, dir: feedDir(), publicKey: publicKey() }));
  log(
    `VersionDrift: uploaded feed package: ${result.changed ? `imported, feed built ${result.state.generatedAt}` : 'this feed is already here'}`,
  );
  if (result.changed) await afterSync?.();
  return result;
}

/** Called once at server start in self-hosted mode; `then` runs after each sync (notifications). */
export function startFeedSync(then?: () => Promise<void>): void {
  if (schedule) return;
  afterSync = then;
  void mkdir(importDir(), { recursive: true }).catch(() => undefined);
  if (!feedSource())
    console.log(
      `VersionDrift: VD_FEED_URL=off, no network sync: upload feed packages in Settings → Feed or copy them into ${importDir()}`,
    );
  void syncNow();
  const pattern = env.VD_FEED_SYNC || '0 3 * * *';
  schedule = new Cron(
    pattern,
    { timezone: env.VD_TZ || env.TZ || 'UTC', protect: true },
    () => void syncNow(),
  );
  // Packages copied into the folder between syncs.
  setInterval(() => {
    void (async () => {
      if (running || (await waitingPackages()).length === 0) return;
      if (await exclusive(() => importFolder(console.log))) await afterSync?.();
    })();
  }, 60_000).unref();
}

export const feedSyncState = (): Promise<SyncState> => readSyncState(feedDir());
