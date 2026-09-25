import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { feedDir } from '$lib/server/feed-sync';
import { mode } from '$lib/server/storage';
import type { RequestHandler } from './$types';

// The verified local feed mirror, for this instance's browsers and its own server-side loads.
export const GET: RequestHandler = async ({ params, request }) => {
  if (mode() !== 'selfhosted') error(404, 'Not found');
  const root = feedDir();
  const file = path.resolve(root, params.path);
  if (!file.startsWith(root + path.sep) || (!file.endsWith('.json') && !file.endsWith('.minisig')))
    error(404, 'Not found');
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    if (params.path === 'v1/index.json')
      error(503, 'The feed has not been synced yet; try again in a minute');
    error(404, 'Not found');
  }
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
  const headers = {
    etag,
    'content-type': file.endsWith('.json') ? 'application/json' : 'text/plain',
    'cache-control': 'no-cache',
    // Public data, like feed.versiondrift.dev: other apps (and the e2e public site) may read it.
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'ETag',
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(body), { headers });
};
