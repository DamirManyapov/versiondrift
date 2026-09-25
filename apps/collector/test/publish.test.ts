import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Health, Module } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { syncModuleIssues, type GitHubIssues } from '../src/issues.ts';
import { generateSigningKey, parseSecret, publicKeyOf, signFile, verifyFile } from '../src/minisign.ts';
import { cacheControlFor, publishFeed, pullState, pushState } from '../src/publish.ts';
import type { R2Bucket } from '../src/r2.ts';
import { sha256 } from '../src/build.ts';

function memoryBucket() {
  const objects = new Map<string, { body: Uint8Array; contentType: string; cacheControl?: string }>();
  const order: string[] = [];
  const bucket: R2Bucket = {
    put(key, body, headers) {
      objects.set(key, { body: typeof body === 'string' ? Buffer.from(body) : body, ...headers });
      order.push(key);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objects.get(key)?.body),
  };
  return { bucket, objects, order };
}

const quiet = { info() {} };

describe('minisign', () => {
  const { secret, publicKey } = generateSigningKey();
  const key = parseSecret(secret);

  it('signs and verifies, covering the trusted comment', () => {
    const sig = signFile('hello', key, 'timestamp:1 file:x');
    expect(verifyFile('hello', sig, publicKey)).toBe('timestamp:1 file:x');
    expect(publicKeyOf(key)).toBe(publicKey);
  });

  it('rejects changed data, a changed trusted comment and another key', () => {
    const sig = signFile('hello', key, 'ok');
    expect(() => verifyFile('hellO', sig, publicKey)).toThrow(/invalid signature/);
    expect(() =>
      verifyFile('hello', sig.replace('trusted comment: ok', 'trusted comment: evil'), publicKey),
    ).toThrow(/trusted comment/);
    expect(() => verifyFile('hello', sig, generateSigningKey().publicKey)).toThrow(/different key/);
  });
});

async function feedDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vd-publish-'));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  return dir;
}

describe('publishFeed', () => {
  const { secret, publicKey } = generateSigningKey();
  const key = parseSecret(secret);

  it('uploads products first and index last, signs the index, skips unchanged products', async () => {
    const unchanged = '{"id":"a"}';
    const dir = await feedDir({
      'v1/index.json': '{"products":{}}',
      'v1/products/a.json': unchanged,
      'v1/products/b.json': '{"id":"b"}',
      'v1/catalog.json': '{}',
      'v1/week/2026-W39.json': '{}',
    });
    const { bucket, objects, order } = memoryBucket();
    const published = { products: { a: { sha256: sha256(unchanged) } } } as never;
    const result = await publishFeed({ dir, bucket, key, published, log: quiet });

    expect(result.skipped).toEqual(['v1/products/a.json']);
    expect(order[0]).toBe('v1/products/b.json');
    expect(order.slice(-2)).toEqual(['v1/index.json.minisig', 'v1/index.json']);
    const index = objects.get('v1/index.json')!;
    const sig = Buffer.from(objects.get('v1/index.json.minisig')!.body).toString();
    expect(verifyFile(Buffer.from(index.body), sig, publicKey)).toMatch(
      /^timestamp:\d+\tfile:index\.json\tsha256:[0-9a-f]{64}$/,
    );
    expect(index).toMatchObject({
      contentType: 'application/json',
      cacheControl: cacheControlFor('v1/index.json'),
    });
    expect(await readFile(path.join(dir, 'v1/index.json.minisig'), 'utf8')).toBe(sig);
  });

  it('refuses to publish without an index', async () => {
    const dir = await feedDir({ 'v1/catalog.json': '{}' });
    await expect(publishFeed({ dir, bucket: memoryBucket().bucket, key, log: quiet })).rejects.toThrow(
      /index\.json not found/,
    );
  });

  it('caches index and health briefly, everything else longer', () => {
    expect(cacheControlFor('v1/index.json')).toContain('max-age=300');
    expect(cacheControlFor('v1/health.json')).toContain('max-age=300');
    expect(cacheControlFor('v1/products/grafana.json')).toContain('max-age=3600');
  });
});

describe('HTTP cache state', () => {
  it('round-trips the cache directory through the state bucket', async () => {
    const source = await feedDir({ 'a.json': '{"etag":"1"}', 'b.json': '{"etag":"2"}' });
    const { bucket } = memoryBucket();
    await pushState(source, bucket, quiet);
    const target = path.join(await mkdtemp(path.join(tmpdir(), 'vd-state-')), 'http');
    await pullState(target, bucket, quiet);
    expect(await readFile(path.join(target, 'b.json'), 'utf8')).toBe('{"etag":"2"}');
  });
});

describe('syncModuleIssues', () => {
  function fakeGitHub(open: { number: number; title: string }[]) {
    const calls: string[] = [];
    const github: GitHubIssues = {
      listOpen: () => Promise.resolve(open),
      create: (title, body) => {
        calls.push(`create ${title} :: ${body}`);
        return Promise.resolve();
      },
      comment: (n) => {
        calls.push(`comment #${n}`);
        return Promise.resolve();
      },
      close: (n) => {
        calls.push(`close #${n}`);
        return Promise.resolve();
      },
    };
    return { github, calls };
  }
  const entry = (status: 'ok' | 'failed', consecutiveFailures: number) => ({
    status,
    consecutiveFailures,
    lastAttemptAt: '2026-09-26T02:00:00Z',
    lastSuccessAt: null,
    releases: 0,
    warnings: [],
    ...(status === 'failed' && { error: 'HTTP 404' }),
  });
  const health = (modules: Record<string, ReturnType<typeof entry>>): Health => ({
    formatVersion: '1.0',
    generatedAt: '2026-09-26T02:00:00Z',
    ok: 1,
    modules,
  });
  const modules = [{ id: 'zabbix', maintainers: ['@alice'] }] as Module[];

  it('opens an issue on the 3rd failure, mentioning maintainers, and not before', async () => {
    const { github, calls } = fakeGitHub([]);
    await syncModuleIssues(
      health({ zabbix: entry('failed', 3), grafana: entry('failed', 2) }),
      modules,
      github,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^create Module zabbix is failing :: [\s\S]*HTTP 404[\s\S]*cc @alice/);
  });

  it('does not duplicate an open issue and closes it once the module recovers', async () => {
    const { github, calls } = fakeGitHub([{ number: 7, title: 'Module zabbix is failing' }]);
    await syncModuleIssues(health({ zabbix: entry('failed', 5) }), modules, github);
    expect(calls).toEqual([]);
    await syncModuleIssues(health({ zabbix: entry('ok', 0) }), modules, github);
    expect(calls).toEqual(['comment #7', 'close #7']);
  });
});
