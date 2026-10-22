#!/usr/bin/env node
// pnpm notify run --inventory inventory.yaml --state notify-state.json [--lang ru]
// Sends to Mattermost when MATTERMOST_WEBHOOK_URL is set (MATTERMOST_CHANNEL optional), else to Telegram with
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (unless --dry-run). See docs/07-self-hosted.md "Telegram alerts".
import { readFile, writeFile } from 'node:fs/promises';
import { r2Bucket } from '@versiondrift/collector';
import { Inventory } from '@versiondrift/schema';
import { Command } from 'commander';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_FEED_URL, loadFeed } from './feed.ts';
import {
  alertMessage,
  channel,
  EMPTY_STATE,
  runNotify,
  telegram,
  TEXT,
  type NotifyState,
} from '@versiondrift/alerts';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** "notify-state.json" (a file) or "r2:notify/state.json" (the private state bucket; needs CLOUDFLARE_*). */
function stateStore(location: string) {
  if (location.startsWith('r2:')) {
    const key = location.slice(3);
    const bucket = () =>
      r2Bucket({
        accountId: env('CLOUDFLARE_ACCOUNT_ID'),
        token: env('CLOUDFLARE_API_TOKEN'),
        bucket: 'versiondrift-state',
      });
    return {
      async load(): Promise<NotifyState> {
        const body = await bucket().get(key);
        return body ? (JSON.parse(Buffer.from(body).toString('utf8')) as NotifyState) : EMPTY_STATE;
      },
      save: (state: NotifyState) =>
        bucket().put(key, JSON.stringify(state, null, 1), { contentType: 'application/json' }),
    };
  }
  return {
    async load(): Promise<NotifyState> {
      try {
        return JSON.parse(await readFile(location, 'utf8')) as NotifyState;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_STATE;
        throw error;
      }
    },
    save: (state: NotifyState) => writeFile(location, JSON.stringify(state, null, 1) + '\n'),
  };
}

/** Where messages go: Mattermost when its webhook is set, else Telegram. Messages are Telegram-flavoured HTML. */
function messenger(): { send(html: string): Promise<void> } {
  const url = process.env.MATTERMOST_WEBHOOK_URL;
  if (url) {
    const mm = channel({
      kind: 'mattermost',
      url,
      ...(process.env.MATTERMOST_CHANNEL && { channel: process.env.MATTERMOST_CHANNEL }),
    });
    return { send: (html) => mm.send(alertMessage(html)) };
  }
  return telegram(env('TELEGRAM_BOT_TOKEN'), env('TELEGRAM_CHAT_ID'));
}

const program = new Command('notify');

program
  .command('run')
  .description('check your inventory against the feed and send Telegram messages for what changed')
  .option('--inventory <file>', 'inventory.yaml (or set NOTIFY_INVENTORY to its contents)')
  .option('--state <file|r2:key>', 'where to remember what was sent', 'notify-state.json')
  .option('--feed <url>', 'feed base URL', process.env.FEED_URL ?? DEFAULT_FEED_URL)
  .option('--lang <en|ru>', 'message language', process.env.NOTIFY_LANG ?? 'en')
  .option('--digest <day|off>', 'weekly summary day (UTC)', 'mon')
  .option('--no-verify', 'skip the feed signature check (private feeds without a key)')
  .option('--dry-run', 'print the messages instead of sending them; state is not saved')
  .action(
    async (opts: {
      inventory?: string;
      state: string;
      feed: string;
      lang: string;
      digest: string;
      verify: boolean;
      dryRun?: boolean;
    }) => {
      if (opts.lang !== 'en' && opts.lang !== 'ru') throw new Error('--lang must be en or ru');
      const yaml = opts.inventory ? await readFile(opts.inventory, 'utf8') : env('NOTIFY_INVENTORY');
      const inventory = Inventory.parse(parseYaml(yaml));
      const digestDay = opts.digest === 'off' ? null : DAYS.indexOf(opts.digest.slice(0, 3).toLowerCase());
      if (digestDay === -1) throw new Error('--digest must be a weekday (sun … sat) or off');
      const store = stateStore(opts.state);
      const feed = await loadFeed(opts.feed, opts.verify ? {} : { publicKey: null });
      const result = await runNotify(inventory, feed, await store.load(), {
        lang: opts.lang,
        now: new Date(),
        digestDay,
      });
      // Actions logs of a public repository are public: there, name no product of the inventory.
      if (process.env.GITHUB_ACTIONS === 'true' && result.problems.length > 0)
        console.warn(
          `warning: ${result.problems.length} problem(s), details hidden in CI (run --dry-run locally)`,
        );
      else for (const problem of result.problems) console.warn(`warning: ${problem}`);
      console.log(`${result.checked.length} instance(s) checked, ${result.messages.length} message(s)`);
      if (opts.dryRun) {
        for (const message of result.messages) console.log(`\n---\n${message}`);
        return;
      }
      const out = messenger();
      for (const message of result.messages) await out.send(message);
      await store.save(result.state);
    },
  );

program
  .command('test')
  .description(
    'send a test message to check MATTERMOST_WEBHOOK_URL, or TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID',
  )
  .option('--lang <en|ru>', 'message language', process.env.NOTIFY_LANG ?? 'en')
  .action(async (opts: { lang: string }) => {
    await messenger().send(TEXT[opts.lang === 'ru' ? 'ru' : 'en'].test);
    console.log('sent');
  });

await program.parseAsync();
