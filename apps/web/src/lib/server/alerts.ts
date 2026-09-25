// Self-hosted notifications (docs/07 "Notifications"): after every feed sync, each enabled channel gets what
// changed for the instance's boards since its last delivery (the same logic as `pnpm notify`, @versiondrift/alerts).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  alertMessage,
  channel,
  EMPTY_STATE,
  runNotify,
  TEXT,
  type AlertEvent,
  type ChannelConfig,
  type Feed,
  type NotifyState,
} from '@versiondrift/alerts';
import { DEFAULT_SETTINGS } from '@versiondrift/core';
import type { AlertEventName, ChannelRecord } from '@versiondrift/db';
import { FeedIndex, FeedProduct, type Inventory, type InstanceSpec } from '@versiondrift/schema';
import { feedDir } from './feed-sync.ts';
import { selfHostedStorage } from './storage.ts';

/** The verified local mirror as the alerts' Feed. */
export async function localFeed(dir = path.join(feedDir(), 'v1')): Promise<Feed> {
  const index = FeedIndex.parse(JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8')));
  return {
    index,
    async product(id) {
      if (!index.products[id]) return undefined;
      return FeedProduct.parse(JSON.parse(await readFile(path.join(dir, 'products', `${id}.json`), 'utf8')));
    },
  };
}

/** Every board's products with a version, as an inventory (products followed without a version have no status). */
export function boardsInventory(): Inventory {
  const { store } = selfHostedStorage();
  const boards: Inventory['boards'] = {};
  for (const board of store.boards()) {
    const products: Record<string, InstanceSpec[]> = {};
    for (const item of store.items(board.id) ?? []) {
      if (!item.ver) continue;
      (products[item.p] ??= []).push({
        version: item.ver,
        ...(item.track && { track: item.track }),
        ...(item.label && { label: item.label }),
      });
    }
    boards[board.name] = { products };
  }
  return { boards };
}

/** Which events a channel's subscriptions let through. The first-run summary always goes out. */
export function wanted(event: AlertEvent, subscribed: AlertEventName[]): boolean {
  if (event.type === 'summary') return true;
  if (event.type === 'digest') return subscribed.includes('digest');
  return event.kinds.some(
    (kind) =>
      (kind === 'critical' && subscribed.includes('critical')) ||
      ((kind === 'eol' || kind === 'eolSoon') && subscribed.includes('eol')) ||
      (kind === 'update' && subscribed.includes('update')) ||
      kind === 'invalid',
  );
}

const titleOf = (event: AlertEvent, lang: 'en' | 'ru') =>
  event.type === 'digest' ? `VersionDrift: ${TEXT[lang].digest}` : 'VersionDrift';

async function deliver(record: ChannelRecord, feed: Feed, inventory: Inventory, now: Date) {
  const { store, channels } = selfHostedStorage();
  const settings = store.settings();
  const criticalCvss = typeof settings.criticalCvss === 'number' ? settings.criticalCvss : 7;
  const result = await runNotify(inventory, feed, (record.state as NotifyState | null) ?? EMPTY_STATE, {
    lang: record.lang,
    now,
    digestDay: record.digestDay,
    settings: { ...DEFAULT_SETTINGS, criticalCvss },
  });
  const target = channel(configOf(record));
  const events = result.events.filter((e) => wanted(e, record.events));
  try {
    for (const event of events) await target.send(alertMessage(event.html, titleOf(event, record.lang)));
    channels.recordRun(record.id, { state: result.state, at: now.toISOString(), sent: events.length });
  } catch (error) {
    // The state stays as it was, so the next run reports the same changes again.
    channels.recordRun(record.id, { error: (error as Error).message });
    throw error;
  }
}

/** The channel's kind and its (decrypted) settings. */
const configOf = (record: ChannelRecord) =>
  ({ ...record.config, kind: record.kind }) as unknown as ChannelConfig;

let running: Promise<void> | undefined;

/** One pass over all enabled channels; a failing channel doesn't stop the others. */
export function runAlerts(log: (line: string) => void = console.log, now: Date = new Date()): Promise<void> {
  running ??= (async () => {
    const enabled = selfHostedStorage()
      .channels.list()
      .filter((c) => c.enabled);
    if (enabled.length === 0) return;
    const feed = await localFeed();
    const inventory = boardsInventory();
    for (const record of enabled) {
      try {
        await deliver(record, feed, inventory, now);
      } catch (error) {
        log(`VersionDrift: notification channel "${record.name}" failed: ${(error as Error).message}`);
      }
    }
  })()
    .catch((error: unknown) => log(`VersionDrift: notifications skipped: ${(error as Error).message}`))
    .finally(() => (running = undefined));
  return running;
}

/** "Send test" in Settings: proves the channel's settings work, without touching its state. */
export async function sendTest(record: ChannelRecord): Promise<void> {
  await channel(configOf(record)).send(alertMessage(TEXT[record.lang].test));
}
