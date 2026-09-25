// Recorded HTTP responses for tests (CLAUDE.md: fixtures in packages/adapters/test/fixtures/<adapter>/).
// A fixture is one JSON file per request, named after the URL so diffs stay readable. Request headers
// (and therefore tokens) are never stored.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FetchFn } from './fetcher.ts';

export interface Fixture {
  method: string;
  url: string;
  requestBody?: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

const KEPT_HEADERS = ['content-type', 'etag', 'last-modified', 'link'];

export function fixtureName(method: string, url: string, body?: string): string {
  const u = new URL(url);
  const readable = `${u.host}${u.pathname}${u.search}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  const hash = createHash('sha256')
    .update(`${method} ${url} ${body ?? ''}`)
    .digest('hex')
    .slice(0, 8);
  return `${readable}-${hash}.json`;
}

/** Wraps a real FetchFn and saves every response into `dir`. */
export function recordingFetch(inner: FetchFn, dir: string): FetchFn {
  return async (url, init) => {
    const response = await inner(url, init);
    const body = await response.text();
    const method = init.method ?? 'GET';
    const requestBody = typeof init.body === 'string' ? init.body : undefined;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (KEPT_HEADERS.includes(key)) headers[key] = value;
    });
    const fixture: Fixture = {
      method,
      url,
      ...(requestBody !== undefined && { requestBody }),
      status: response.status,
      headers,
      body,
    };
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, fixtureName(method, url, requestBody)),
      JSON.stringify(fixture, null, 1) + '\n',
    );
    return new Response(response.status === 304 ? null : body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

/** Serves responses from fixtures in `dir`; a request without a fixture fails loudly (tests never hit the network). */
export function fixtureFetch(dir: string): FetchFn {
  return async (url, init) => {
    const method = init.method ?? 'GET';
    const requestBody = typeof init.body === 'string' ? init.body : undefined;
    const name = fixtureName(method, url, requestBody);
    let fixture: Fixture;
    try {
      fixture = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Fixture;
    } catch {
      throw new Error(`no fixture for ${method} ${url} (expected ${path.join(dir, name)}); record it first`);
    }
    return new Response(fixture.status === 304 ? null : fixture.body, {
      status: fixture.status,
      headers: fixture.headers,
    });
  };
}
