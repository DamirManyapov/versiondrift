// The offline feed package (docs/07 "Offline feed package"): the signed v1/ tree of a feed as one tar.gz, for
// instances that can't reach feed.versiondrift.dev. It carries index.json with its minisign signature, so it may travel
// any way (a USB stick, a file share, a mirror unpacked on an internal web server): an instance imports it through the
// same checks as a network sync, and refuses a package older than the feed it already has.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { FeedIndex } from '@versiondrift/schema';
import { verifyFile } from './minisign.ts';
import { FEED_PUBLIC_KEY, readSyncState, syncFeed, type SyncResult } from './sync.ts';

/** The package's file name next to the feed (feed.versiondrift.dev/…, an instance's /feed/…). */
export const BUNDLE_NAME = 'versiondrift-feed.tar.gz';

/** Unpacked, a package this big is not ours (the real feed is ~15 MB). */
const MAX_UNPACKED = 512 * 1024 * 1024;

const README = (generatedAt: string) => `VersionDrift feed package, generated ${generatedAt}.

v1/ is the signed public feed. To bring an instance up to date without Internet access:
- upload this file in Settings → Feed, or
- copy it into the instance's data directory, folder feed-import/ (for example /data/feed-import/), or
- unpack it on an internal web server and set VD_FEED_URL to the directory that holds v1/.

The instance checks the minisign signature of v1/index.json and the sha256 of every product file, and refuses a
package older than the feed it already has. https://versiondrift.dev
`;

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

// ustar: a 512-byte header per file, the content padded to 512 bytes, two zero blocks at the end.
function header(name: string, size: number, mtime: number): Buffer {
  const block = Buffer.alloc(512);
  let prefix = '';
  let short = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`${name}: path too long`);
    prefix = name.slice(0, cut);
    short = name.slice(cut + 1);
  }
  const octal = (value: number, width: number) => value.toString(8).padStart(width - 1, '0') + '\0';
  block.write(short, 0, 100);
  block.write(octal(0o644, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(size, 12), 124);
  block.write(octal(mtime, 12), 136);
  block.write('        ', 148);
  block.write('0', 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  block.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

/** tar.gz of files (path → content), in the given order. */
export function packTar(files: [string, Uint8Array | string][], mtime = new Date()): Buffer {
  const seconds = Math.floor(mtime.getTime() / 1000);
  const parts: Buffer[] = [];
  for (const [name, content] of files) {
    const body = Buffer.from(content);
    parts.push(header(name, body.length, seconds), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

/** Regular files of a tar.gz (or a plain tar), by path without a leading "./"; ustar, pax and GNU long names. */
export function unpackTar(archive: Uint8Array): Map<string, Buffer> {
  const bytes = Buffer.from(archive);
  const tar =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: MAX_UNPACKED }) : bytes;
  const files = new Map<string, Buffer>();
  const text = (from: number, length: number) => {
    const raw = tar.subarray(from, from + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
  };
  let offset = 0;
  let nextName: string | undefined;
  while (offset + 512 <= tar.length) {
    if (tar.subarray(offset, offset + 512).every((b) => b === 0)) break;
    const sizeField = text(offset + 124, 12).trim();
    if (!/^[0-7]*$/.test(sizeField)) throw new Error('not a tar archive');
    const size = parseInt(sizeField || '0', 8);
    const type = String.fromCharCode(tar[offset + 156]!);
    const start = offset + 512;
    if (start + size > tar.length) throw new Error('the archive is cut short');
    const body = tar.subarray(start, start + size);
    const ustar = text(offset + 257, 6).startsWith('ustar');
    const prefix = ustar ? text(offset + 345, 155) : '';
    let name = nextName ?? (prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100));
    if (type === 'x') {
      // pax extended header: "<length> path=<value>\n" records; only the path matters here.
      nextName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1] ?? nextName;
    } else if (type === 'L') nextName = body.toString('utf8').replace(/\0+$/, '');
    else {
      nextName = undefined;
      if (type === '0' || type === '\0') {
        name = name.replace(/^(\.\/)+/, '');
        if (name && !files.has(name)) files.set(name, Buffer.from(body));
      }
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The package for a feed directory (the one holding v1/, with index.json.minisig): v1/ plus a README. */
export async function packBundle(dir: string): Promise<{ bytes: Buffer; generatedAt: string }> {
  const v1 = path.join(dir, 'v1');
  const indexText = await readFile(path.join(v1, 'index.json'), 'utf8').catch(() => {
    throw new Error(`${v1}/index.json not found`);
  });
  // Only the date is needed here; the importing instance validates the index in full.
  const { generatedAt } = JSON.parse(indexText) as { generatedAt?: unknown };
  if (typeof generatedAt !== 'string') throw new Error(`${v1}/index.json has no generatedAt`);
  const names = (await listFiles(v1))
    .filter((f) => (f.endsWith('.json') || f === 'index.json.minisig') && f !== 'index.json')
    .sort();
  if (!names.includes('index.json.minisig')) throw new Error(`${v1}/index.json is not signed`);
  const files: [string, Uint8Array | string][] = [['README.txt', README(generatedAt)]];
  for (const name of names) files.push([`v1/${name}`, await readFile(path.join(v1, name))]);
  files.push(['v1/index.json', indexText]);
  return { bytes: packTar(files, new Date(generatedAt)), generatedAt };
}

export interface ImportOptions {
  /** The package: tar.gz (or tar) holding v1/. */
  bytes: Uint8Array;
  /** The local mirror's base directory, as for syncFeed. */
  dir: string;
  /** minisign public key; null skips verification (tests of unsigned feeds only). */
  publicKey?: string | null;
  now?: Date;
}

/** Brings the local mirror up to date from a package; throws, changing nothing, when the package is refused. */
export async function importBundle(options: ImportOptions): Promise<SyncResult> {
  let files: Map<string, Buffer>;
  try {
    files = unpackTar(options.bytes);
  } catch (error) {
    throw new Error(`not a VersionDrift feed package: ${(error as Error).message}`, { cause: error });
  }
  const inV1 = new Map<string, Buffer>();
  for (const [name, body] of files) {
    const at = name.split('/').indexOf('v1');
    if (at !== -1)
      inV1.set(
        name
          .split('/')
          .slice(at + 1)
          .join('/'),
        body,
      );
  }
  const indexBytes = inV1.get('index.json');
  if (!indexBytes) throw new Error('not a VersionDrift feed package: there is no v1/index.json in it');
  const indexText = indexBytes.toString('utf8');
  const publicKey = options.publicKey === undefined ? FEED_PUBLIC_KEY : options.publicKey;
  if (publicKey !== null) {
    const signature = inV1.get('index.json.minisig');
    if (!signature) throw new Error('the package is not signed (no v1/index.json.minisig)');
    verifyFile(indexText, signature.toString('utf8'), publicKey);
  }
  const index = FeedIndex.parse(JSON.parse(indexText));

  // Never go back: an old package must not replace a newer feed (and replaying one gains nothing).
  const current = await readSyncState(options.dir);
  if (current.generatedAt && index.generatedAt < current.generatedAt)
    throw new Error(
      `the package is older than the feed this instance has (${index.generatedAt} < ${current.generatedAt})`,
    );
  if (current.generatedAt === index.generatedAt) return { changed: false, downloaded: 0, state: current };

  // The network sync, reading from the package: same signature and hash checks, same atomic replace.
  const fromPackage = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = inV1.get(decodeURIComponent(url.pathname).replace(/^\/v1\//, ''));
    return Promise.resolve(body ? new Response(new Uint8Array(body)) : new Response(null, { status: 404 }));
  };
  return syncFeed({
    source: 'https://package.invalid/',
    dir: options.dir,
    publicKey,
    fetch: fromPackage,
    ...(options.now && { now: options.now }),
  });
}
