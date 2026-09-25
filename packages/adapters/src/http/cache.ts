import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A stored response, reused when the server answers 304 Not Modified. */
export interface CacheEntry {
  url: string;
  etag?: string;
  lastModified?: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  storedAt: string;
}

export interface HttpCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

export class MemoryHttpCache implements HttpCache {
  readonly entries = new Map<string, CacheEntry>();
  get(key: string): Promise<CacheEntry | undefined> {
    return Promise.resolve(this.entries.get(key));
  }
  set(key: string, entry: CacheEntry): Promise<void> {
    this.entries.set(key, entry);
    return Promise.resolve();
  }
}

/** One JSON file per request in `dir` (named by a hash of the key); the collector persists `dir` between runs. */
export class FileHttpCache implements HttpCache {
  readonly dir: string;
  /** Keys read or written in this process, so stale entries can be pruned after a run. */
  readonly used = new Set<string>();

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(key: string): string {
    return path.join(this.dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    this.used.add(key);
    try {
      return JSON.parse(await readFile(this.file(key), 'utf8')) as CacheEntry;
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.used.add(key);
    await mkdir(this.dir, { recursive: true });
    const file = this.file(key);
    await writeFile(`${file}.tmp`, JSON.stringify(entry));
    await rename(`${file}.tmp`, file);
  }

  /** File names of the entries used in this run (everything else in `dir` can be deleted). */
  usedFiles(): Set<string> {
    return new Set([...this.used].map((key) => path.basename(this.file(key))));
  }
}
