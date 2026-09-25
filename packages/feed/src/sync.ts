// A verified local mirror of the public feed (docs/07 "Feed sync"): self-hosted instances serve it to their browsers,
// so nothing on the LAN talks to feed.versiondrift.dev except this sync. index.json must carry a valid minisign
// signature; every product file must match the sha256 the signed index lists. Files are replaced atomically and
// index.json last, so readers never pair a new index with missing products.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FeedIndex } from '@versiondrift/schema';
import { verifyFile } from './minisign.ts';
import { recentWeeks } from './week.ts';

/** keys/feed.pub — the key the official collector signs with. */
export const FEED_PUBLIC_KEY = 'RWS5QKz6JGR7xISHHllazU/WZfqYkET1YLLxuKPMlK8s7N13793Wd/2N';
export const DEFAULT_FEED_URL = 'https://feed.versiondrift.dev/';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export interface SyncOptions {
  /** Upstream feed base (the directory holding v1/); a URL ending in /v1/ works too. */
  source: string;
  /** Local base directory; files land in <dir>/v1/…. */
  dir: string;
  /** minisign public key; null skips verification (tests of unsigned feeds only). */
  publicKey?: string | null;
  fetch?: typeof fetch;
  now?: Date;
  /** Weekly digests to keep (the feed publishes 12). */
  weeks?: number;
}

export interface SyncState {
  syncedAt: string | null;
  generatedAt: string | null;
  indexEtag: string | null;
  verified: boolean;
  products: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface SyncResult {
  changed: boolean;
  downloaded: number;
  state: SyncState;
}

const EMPTY_STATE: SyncState = {
  syncedAt: null,
  generatedAt: null,
  indexEtag: null,
  verified: false,
  products: 0,
  lastError: null,
  lastErrorAt: null,
};

const stateFile = (dir: string) => path.join(dir, 'sync-state.json');

export async function readSyncState(dir: string): Promise<SyncState> {
  try {
    return { ...EMPTY_STATE, ...(JSON.parse(await readFile(stateFile(dir), 'utf8')) as Partial<SyncState>) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, content);
  await rename(temp, file);
}

const upstreamRoot = (source: string) => {
  const base = source.endsWith('/') ? source : `${source}/`;
  return new URL(base.endsWith('/v1/') ? base : `${base}v1/`);
};

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Brings <dir>/v1 up to date with the upstream feed. Throws (and records lastError) when it can't. */
export async function syncFeed(options: SyncOptions): Promise<SyncResult> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? new Date();
  const root = upstreamRoot(options.source);
  const local = path.join(options.dir, 'v1');
  const publicKey = options.publicKey === undefined ? FEED_PUBLIC_KEY : options.publicKey;
  const previous = await readSyncState(options.dir);
  const get = async (file: string, headers: Record<string, string> = {}) => {
    const response = await doFetch(new URL(file, root), { headers });
    if (!response.ok && response.status !== 304) throw new Error(`${file}: HTTP ${response.status}`);
    return response;
  };

  try {
    const haveIndex = (await readText(path.join(local, 'index.json'))) !== undefined;
    const indexResponse = await get(
      'index.json',
      previous.indexEtag && haveIndex ? { 'if-none-match': previous.indexEtag } : {},
    );
    if (indexResponse.status === 304) {
      const state = { ...previous, syncedAt: now.toISOString(), lastError: null, lastErrorAt: null };
      await writeAtomic(stateFile(options.dir), JSON.stringify(state, null, 2));
      return { changed: false, downloaded: 0, state };
    }
    const indexText = await indexResponse.text();
    let signature: string | undefined;
    if (publicKey !== null) {
      signature = await (await get('index.json.minisig')).text();
      verifyFile(indexText, signature, publicKey);
    }
    const index = FeedIndex.parse(JSON.parse(indexText));

    // Product files: download what changed, check each against the signed hash, then move all into place.
    const entries = Object.entries(index.products);
    const staged: { file: string; text: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const [id, entry] = entries[next++]!;
        const file = path.join(local, 'products', `${id}.json`);
        if (sha256((await readText(file)) ?? '') === entry.sha256) continue;
        const text = await (await get(entry.url)).text();
        if (sha256(text) !== entry.sha256)
          throw new Error(`${id}: product file does not match the signed index`);
        staged.push({ file, text });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    for (const { file, text } of staged) await writeAtomic(file, text);

    // Display-only files the index doesn't sign; a missing one (older feeds, a week without a digest) is fine.
    const extras = [
      'catalog.json',
      'health.json',
      'versions.json',
      ...recentWeeks(now, options.weeks ?? 12).map((w) => `week/${w}.json`),
    ];
    for (const file of extras) {
      const response = await doFetch(new URL(file, root));
      if (response.ok) await writeAtomic(path.join(local, file), await response.text());
    }

    if (signature !== undefined) await writeAtomic(path.join(local, 'index.json.minisig'), signature);
    await writeAtomic(path.join(local, 'index.json'), indexText);

    // Products that left the catalog.
    const keep = new Set(Object.keys(index.products).map((id) => `${id}.json`));
    for (const name of await readdir(path.join(local, 'products')).catch(() => [] as string[]))
      if (name.endsWith('.json') && !keep.has(name))
        await rm(path.join(local, 'products', name), { force: true });

    const state: SyncState = {
      syncedAt: now.toISOString(),
      generatedAt: index.generatedAt,
      indexEtag: indexResponse.headers.get('etag'),
      verified: publicKey !== null,
      products: entries.length,
      lastError: null,
      lastErrorAt: null,
    };
    await writeAtomic(stateFile(options.dir), JSON.stringify(state, null, 2));
    return { changed: true, downloaded: staged.length, state };
  } catch (error) {
    const state = { ...previous, lastError: (error as Error).message, lastErrorAt: now.toISOString() };
    await writeAtomic(stateFile(options.dir), JSON.stringify(state, null, 2)).catch(() => undefined);
    throw error;
  }
}
