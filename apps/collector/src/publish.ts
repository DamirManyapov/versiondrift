// docs/04 step 11: sign index.json and upload the feed — product files first, index last.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Logger } from '@versiondrift/adapters';
import { BUNDLE_NAME, packBundle } from '@versiondrift/feed';
import type { FeedIndex } from '@versiondrift/schema';
import { sha256 } from './build.ts';
import { signFile, type SigningKey } from './minisign.ts';
import type { R2Bucket } from './r2.ts';

/** Index, signature, health and the offline package change every run; the rest is also reachable through versioned URLs. */
export function cacheControlFor(key: string): string {
  return /(^|\/)(index\.json(\.minisig)?|health\.json|versiondrift-feed\.tar\.gz)$/.test(key)
    ? 'public, max-age=300, stale-while-revalidate=3600'
    : 'public, max-age=3600, stale-while-revalidate=86400';
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else out.push(rel);
  }
  return out;
}

export interface PublishOptions {
  /** Directory that contains v1/. */
  dir: string;
  bucket: R2Bucket;
  key: SigningKey;
  /** The currently published index: unchanged product files are not uploaded again. */
  published?: FeedIndex;
  log: Pick<Logger, 'info'>;
  now?: Date;
}

export async function publishFeed(
  options: PublishOptions,
): Promise<{ uploaded: string[]; skipped: string[] }> {
  const files = (await listFiles(options.dir)).filter((f) => f.startsWith('v1/') && !f.endsWith('.minisig'));
  if (!files.includes('v1/index.json'))
    throw new Error(`${options.dir}/v1/index.json not found: run collect first`);

  const indexBytes = await readFile(path.join(options.dir, 'v1/index.json'));
  const timestamp = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const signature = signFile(
    indexBytes,
    options.key,
    `timestamp:${timestamp}\tfile:index.json\tsha256:${sha256(indexBytes.toString())}`,
  );
  await writeFile(path.join(options.dir, 'v1/index.json.minisig'), signature);

  const rank = (f: string) => (f === 'v1/index.json' ? 3 : f.startsWith('v1/products/') ? 0 : 1);
  const ordered = files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const upload = async (key: string, body: string | Uint8Array) => {
    await options.bucket.put(key, body, {
      contentType: 'application/json',
      cacheControl: cacheControlFor(key),
    });
    uploaded.push(key);
  };

  // Product files in parallel, then the rest, then signature + index back to back.
  const products = ordered.filter((f) => rank(f) === 0);
  for (let i = 0; i < products.length; i += 6) {
    await Promise.all(
      products.slice(i, i + 6).map(async (file) => {
        const bytes = await readFile(path.join(options.dir, file), 'utf8');
        const id = path.basename(file, '.json');
        if (options.published?.products[id]?.sha256 === sha256(bytes)) {
          skipped.push(file);
          return;
        }
        await upload(file, bytes);
      }),
    );
  }
  for (const file of ordered.filter((f) => rank(f) === 1))
    await upload(file, await readFile(path.join(options.dir, file)));
  await options.bucket.put('v1/index.json.minisig', signature, {
    contentType: 'text/plain; charset=utf-8',
    cacheControl: cacheControlFor('v1/index.json.minisig'),
  });
  uploaded.push('v1/index.json.minisig');
  await upload('v1/index.json', indexBytes);
  // The offline package (docs/07): the same signed files as one download, after the index it carries.
  const bundle = await packBundle(options.dir);
  await options.bucket.put(BUNDLE_NAME, bundle.bytes, {
    contentType: 'application/gzip',
    cacheControl: cacheControlFor(BUNDLE_NAME),
  });
  uploaded.push(BUNDLE_NAME);
  options.log.info(`published ${uploaded.length} files (${skipped.length} unchanged product files skipped)`);
  return { uploaded, skipped };
}

const STATE_KEY = 'http-cache.json.gz';

/** Saves the HTTP cache directory as one gzipped JSON object in the private state bucket. */
export async function pushState(
  cacheDir: string,
  bucket: R2Bucket,
  log: Pick<Logger, 'info'>,
): Promise<void> {
  const names = await readdir(cacheDir).catch(() => [] as string[]);
  const bundle: Record<string, string> = {};
  for (const name of names) bundle[name] = await readFile(path.join(cacheDir, name), 'utf8');
  const body = gzipSync(JSON.stringify(bundle));
  await bucket.put(STATE_KEY, body, { contentType: 'application/gzip' });
  log.info(`saved HTTP cache: ${names.length} entries, ${(body.length / 1024).toFixed(0)} KiB`);
}

export async function pullState(
  cacheDir: string,
  bucket: R2Bucket,
  log: Pick<Logger, 'info'>,
): Promise<void> {
  const body = await bucket.get(STATE_KEY);
  if (!body) {
    log.info('no saved HTTP cache yet');
    return;
  }
  const bundle = JSON.parse(gunzipSync(body).toString('utf8')) as Record<string, string>;
  await mkdir(cacheDir, { recursive: true });
  for (const [name, content] of Object.entries(bundle)) {
    if (name.includes('/') || name.includes('..')) continue;
    await writeFile(path.join(cacheDir, name), content);
  }
  log.info(`restored HTTP cache: ${Object.keys(bundle).length} entries`);
}
