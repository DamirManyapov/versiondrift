import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FeedIndex, IndexEntry } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import {
  generateSigningKey,
  importBundle,
  recentWeeks,
  packBundle,
  packTar,
  parseSecret,
  readSyncState,
  sha256,
  signFile,
  unpackTar,
} from '../src/index.ts';

const key = generateSigningKey();
const signing = parseSecret(key.secret);
const NOW = new Date('2026-09-28T10:00:00Z');
const WEEK = recentWeeks(NOW, 1)[0]!;
const temp = () => mkdtemp(path.join(tmpdir(), 'vd-bundle-'));

/** A published feed directory: v1/ with products, a signed index, a catalog and this week's digest. */
async function feedDir(generatedAt: string, products: Record<string, string>, sign = true) {
  const dir = await temp();
  await mkdir(path.join(dir, 'v1/products'), { recursive: true });
  await mkdir(path.join(dir, 'v1/week'), { recursive: true });
  const entries: Record<string, IndexEntry> = {};
  for (const [id, text] of Object.entries(products)) {
    await writeFile(path.join(dir, `v1/products/${id}.json`), text);
    entries[id] = {
      name: id,
      category: 'other',
      latest: null,
      latestDate: null,
      tracks: {},
      maxSeverityLast30d: null,
      hasSecuritySource: false,
      updatedAt: generatedAt,
      stale: false,
      sha256: sha256(text),
      url: `products/${id}.json?v=${sha256(text).slice(0, 12)}`,
    };
  }
  const index: FeedIndex = { formatVersion: '1.2', generatedAt, collectorVersion: 'test', products: entries };
  const indexText = JSON.stringify(index);
  await writeFile(path.join(dir, 'v1/index.json'), indexText);
  if (sign) await writeFile(path.join(dir, 'v1/index.json.minisig'), signFile(indexText, signing, 'test'));
  await writeFile(path.join(dir, 'v1/catalog.json'), '{"products":[]}');
  await writeFile(path.join(dir, `v1/week/${WEEK}.json`), '{"week":1}');
  return dir;
}

const importInto = (dir: string, bytes: Uint8Array) =>
  importBundle({ bytes, dir, publicKey: key.publicKey, now: NOW });

describe('offline feed package', () => {
  it('carries a signed feed into an empty instance, then refuses to go back', async () => {
    const source = await feedDir('2026-09-27T02:00:00Z', { grafana: '{"v":1}', nginx: '{"v":1}' });
    const { bytes, generatedAt } = await packBundle(source);
    expect(generatedAt).toBe('2026-09-27T02:00:00Z');
    expect([...unpackTar(bytes).keys()]).toEqual([
      'README.txt',
      'v1/catalog.json',
      'v1/index.json.minisig',
      'v1/products/grafana.json',
      'v1/products/nginx.json',
      `v1/week/${WEEK}.json`,
      'v1/index.json',
    ]);

    const instance = await temp();
    const first = await importInto(instance, bytes);
    expect(first).toMatchObject({ changed: true, downloaded: 2, state: { verified: true, products: 2 } });
    expect(await readFile(path.join(instance, 'v1/products/nginx.json'), 'utf8')).toBe('{"v":1}');
    expect(await readFile(path.join(instance, `v1/week/${WEEK}.json`), 'utf8')).toBe('{"week":1}');
    expect(await readFile(path.join(instance, 'v1/index.json'), 'utf8')).toBe(
      await readFile(path.join(source, 'v1/index.json'), 'utf8'),
    );

    // The same package again changes nothing; a newer one updates only what changed.
    expect(await importInto(instance, bytes)).toMatchObject({ changed: false, downloaded: 0 });
    const newer = await packBundle(await feedDir('2026-09-28T02:00:00Z', { nginx: '{"v":2}' }));
    expect(await importInto(instance, newer.bytes)).toMatchObject({
      changed: true,
      downloaded: 1,
      state: { generatedAt: '2026-09-28T02:00:00Z' },
    });
    expect(await readdir(path.join(instance, 'v1/products'))).toEqual(['nginx.json']);

    await expect(importInto(instance, bytes)).rejects.toThrow(/older than the feed this instance has/);
    expect(await readFile(path.join(instance, 'v1/products/nginx.json'), 'utf8')).toBe('{"v":2}');
  });

  it('completes a partial run from the published feed, checking each file against the index', async () => {
    const source = await feedDir('2026-09-30T09:00:00Z', { n8n: '{"v":1}', grafana: '{"v":7}' });
    const { rm } = await import('node:fs/promises');
    await rm(path.join(source, 'v1/products/grafana.json'));
    await expect(packBundle(source)).rejects.toThrow(/products\/grafana.json is missing/);
    const asked: string[] = [];
    const { bytes } = await packBundle(source, {
      fetchMissing: (file) => {
        asked.push(file);
        return Promise.resolve('{"v":7}');
      },
    });
    expect(asked).toEqual(['products/grafana.json']);
    expect(unpackTar(bytes).get('v1/products/grafana.json')?.toString()).toBe('{"v":7}');
    expect(await importInto(await temp(), bytes)).toMatchObject({ changed: true, state: { products: 2 } });
    await expect(packBundle(source, { fetchMissing: () => Promise.resolve('{"v":6}') })).rejects.toThrow(
      /does not match the index/,
    );
  });

  it('refuses unsigned, forged and tampered packages and anything that is not one', async () => {
    const instance = await temp();
    const unsigned = await feedDir('2026-09-27T02:00:00Z', { grafana: '{"v":1}' }, false);
    await expect(packBundle(unsigned)).rejects.toThrow(/not signed/);

    const good = unpackTar(
      (await packBundle(await feedDir('2026-09-27T02:00:00Z', { grafana: '{"v":1}' }))).bytes,
    );
    const repack = (change: (files: Map<string, Buffer>) => void) => {
      const files = new Map(good);
      change(files);
      return packTar([...files]);
    };
    await expect(
      importInto(
        instance,
        repack((f) => f.delete('v1/index.json.minisig')),
      ),
    ).rejects.toThrow(/not signed/);
    const otherKey = parseSecret(generateSigningKey().secret);
    const forged = repack((f) =>
      f.set(
        'v1/index.json.minisig',
        Buffer.from(signFile(f.get('v1/index.json')!.toString(), otherKey, 'x')),
      ),
    );
    await expect(importInto(instance, forged)).rejects.toThrow(/key|signature/i);
    const tampered = repack((f) => f.set('v1/products/grafana.json', Buffer.from('{"evil":true}')));
    await expect(importInto(instance, tampered)).rejects.toThrow(/does not match the signed index/);
    await expect(importInto(instance, Buffer.from('hello, world'))).rejects.toThrow(
      /not a VersionDrift feed package/,
    );
    await expect(importInto(instance, packTar([['notes.txt', 'hi']]))).rejects.toThrow(/no v1\/index.json/);
    await expect(readdir(path.join(instance, 'v1'))).rejects.toThrow();
    expect((await readSyncState(instance)).generatedAt).toBeNull();
  });

  it('reads archives made by other tar tools: ./ prefixes, pax and GNU long names, a top folder, no gzip', () => {
    const block = (name: string, body: string, type: string) => {
      const header = Buffer.alloc(512);
      header.write(name, 0, 100);
      header.write(`${Buffer.byteLength(body).toString(8).padStart(11, '0')}\0`, 124);
      header.write(type, 156);
      header.write('ustar\0', 257);
      header.write('        ', 148);
      let sum = 0;
      for (const byte of header) sum += byte;
      header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
      const pad = Buffer.alloc((512 - (Buffer.byteLength(body) % 512)) % 512);
      return Buffer.concat([header, Buffer.from(body), pad]);
    };
    const long = `pkg/v1/products/${'x'.repeat(120)}.json`;
    const pax = '28 path=./pkg/v1/index.json\n';
    const tar = Buffer.concat([
      block('./pkg/', '', '5'),
      block('./pkg/v1/catalog.json', '{}', '0'),
      block('PaxHeader/index.json', pax, 'x'),
      block('short-name', '{"i":1}', '0'),
      block('././@LongLink', `${long}\0`, 'L'),
      block('truncated', '{"p":1}', '0'),
      Buffer.alloc(1024),
    ]);
    const files = unpackTar(tar);
    expect(Object.fromEntries([...files].map(([k, v]) => [k, v.toString()]))).toEqual({
      'pkg/v1/catalog.json': '{}',
      'pkg/v1/index.json': '{"i":1}',
      [long]: '{"p":1}',
    });
    expect(unpackTar(gzipSync(tar)).size).toBe(3);
  });
});
