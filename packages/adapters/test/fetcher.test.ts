import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFetcher,
  FileHttpCache,
  fixtureFetch,
  HttpError,
  MemoryHttpCache,
  recordingFetch,
  USER_AGENT,
  type FetchFn,
} from '../src/index.ts';

interface Call {
  url: string;
  headers: Record<string, string>;
  at: number;
}

/** A fake server: answers from a queue per URL and records every call with the (fake) time it started. */
function fakeServer(responses: Record<string, (() => Response)[]>) {
  let clock = 0;
  const calls: Call[] = [];
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, at: clock });
    const next = responses[url]?.shift();
    if (!next) return Promise.reject(new TypeError(`fetch failed: ${url}`));
    return Promise.resolve(next());
  };
  const time = {
    now: () => clock,
    sleep: (ms: number) => {
      clock += ms;
      return Promise.resolve();
    },
  };
  return { fetch, calls, time };
}

const ok =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { status: 200, headers });

describe('createFetcher', () => {
  it('sends the bot User-Agent and per-host auth headers', async () => {
    const server = fakeServer({
      'https://api.github.com/x': [ok('{}')],
      'https://example.com/x': [ok('{}')],
    });
    const fetcher = createFetcher({
      fetch: server.fetch,
      ...server.time,
      auth: { 'api.github.com': { authorization: 'Bearer secret' } },
    });
    await fetcher.json('https://api.github.com/x');
    await fetcher.json('https://example.com/x');
    expect(server.calls[0]?.headers).toMatchObject({
      'user-agent': USER_AGENT,
      authorization: 'Bearer secret',
    });
    expect(server.calls[1]?.headers).not.toHaveProperty('authorization');
  });

  it('spaces requests to the same host but not across hosts', async () => {
    const server = fakeServer({
      'https://a.test/1': [ok('1')],
      'https://a.test/2': [ok('2')],
      'https://b.test/1': [ok('3')],
    });
    const fetcher = createFetcher({ fetch: server.fetch, ...server.time, intervals: { 'a.test': 1000 } });
    await Promise.all([
      fetcher.text('https://a.test/1'),
      fetcher.text('https://a.test/2'),
      fetcher.text('https://b.test/1'),
    ]);
    const at = Object.fromEntries(server.calls.map((c) => [c.url, c.at]));
    expect(at['https://a.test/2']! - at['https://a.test/1']!).toBeGreaterThanOrEqual(1000);
    expect(at['https://b.test/1']).toBeLessThan(1000);
  });

  it('retries network errors and 5xx with backoff, then gives up', async () => {
    const server = fakeServer({
      'https://a.test/flaky': [() => new Response('', { status: 502 }), ok('fine')],
      'https://a.test/down': [],
    });
    const fetcher = createFetcher({ fetch: server.fetch, ...server.time, retries: 2 });
    expect((await fetcher.text('https://a.test/flaky')).body).toBe('fine');
    await expect(fetcher.text('https://a.test/down')).rejects.toThrow(/fetch failed/);
    expect(server.calls.filter((c) => c.url.endsWith('/down'))).toHaveLength(3);
  });

  it('honours Retry-After on 429', async () => {
    const server = fakeServer({
      'https://a.test/x': [
        () => new Response('', { status: 429, headers: { 'retry-after': '7' } }),
        ok('done'),
      ],
    });
    const fetcher = createFetcher({ fetch: server.fetch, ...server.time });
    await fetcher.text('https://a.test/x');
    expect(server.calls[1]!.at - server.calls[0]!.at).toBeGreaterThanOrEqual(7000);
  });

  it('does not wait an hour for an exhausted GitHub rate limit', async () => {
    const reset = String(3600);
    const limited = () =>
      new Response('rate limited', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
      });
    const server = fakeServer({ 'https://api.github.com/x': [limited] });
    const fetcher = createFetcher({ fetch: server.fetch, ...server.time });
    await expect(fetcher.text('https://api.github.com/x')).rejects.toBeInstanceOf(HttpError);
    expect(server.calls).toHaveLength(1);
  });

  it('makes conditional requests and serves 304 from the cache', async () => {
    const server = fakeServer({
      'https://a.test/feed': [ok('v1', { etag: '"abc"' }), () => new Response(null, { status: 304 })],
    });
    const cache = new MemoryHttpCache();
    const fetcher = createFetcher({ fetch: server.fetch, ...server.time, cache });
    const first = await fetcher.text('https://a.test/feed');
    const second = await fetcher.text('https://a.test/feed');
    expect(first).toMatchObject({ body: 'v1', fromCache: false });
    expect(second).toMatchObject({ body: 'v1', fromCache: true, status: 200 });
    expect(server.calls[1]?.headers['if-none-match']).toBe('"abc"');
  });

  it('throws HttpError for non-2xx from text/json but returns it from request', async () => {
    const server = fakeServer({ 'https://a.test/missing': [() => new Response('nope', { status: 404 })] });
    const fetcher = createFetcher({ fetch: server.fetch, ...server.time });
    await expect(fetcher.json('https://a.test/missing')).rejects.toMatchObject({ status: 404 });
    const again = fakeServer({ 'https://a.test/missing': [() => new Response('nope', { status: 404 })] });
    expect(
      (await createFetcher({ fetch: again.fetch, ...again.time }).request('https://a.test/missing')).status,
    ).toBe(404);
  });
});

describe('FileHttpCache', () => {
  it('persists entries across instances', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vd-cache-'));
    const entry = {
      url: 'https://a.test',
      etag: '"1"',
      status: 200,
      headers: {},
      body: 'x',
      storedAt: '2026-01-01T00:00:00Z',
    };
    await new FileHttpCache(dir).set('k', entry);
    const reopened = new FileHttpCache(dir);
    expect(await reopened.get('k')).toEqual(entry);
    expect(reopened.usedFiles()).toEqual(new Set(await readdir(dir)));
  });
});

describe('fixtures', () => {
  it('records responses and replays them without the network', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vd-fixtures-'));
    const server = fakeServer({
      'https://a.test/api?q=1': [ok('{"v":1}', { 'content-type': 'application/json', 'set-cookie': 'x' })],
    });
    const recorded = await recordingFetch(server.fetch, dir)('https://a.test/api?q=1', {
      headers: { authorization: 'secret' },
    });
    expect(await recorded.text()).toBe('{"v":1}');
    const [file] = await readdir(dir);
    expect(file).toMatch(/^a\.test_api_q_1-[0-9a-f]{8}\.json$/);

    const replay = createFetcher({ fetch: fixtureFetch(dir), sleep: () => Promise.resolve() });
    expect(await replay.json('https://a.test/api?q=1')).toEqual({ v: 1 });
    await expect(replay.text('https://a.test/other')).rejects.toThrow(/no fixture/);
  });

  it('never stores request headers or cookies', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vd-fixtures-'));
    const server = fakeServer({ 'https://a.test/x': [ok('{}', { 'set-cookie': 'session=1' })] });
    await recordingFetch(server.fetch, dir)('https://a.test/x', {
      headers: { authorization: 'Bearer secret' },
    });
    const [file] = await readdir(dir);
    const text = await import('node:fs/promises').then((fs) => fs.readFile(path.join(dir, file!), 'utf8'));
    expect(text).not.toMatch(/secret|session/);
  });
});
