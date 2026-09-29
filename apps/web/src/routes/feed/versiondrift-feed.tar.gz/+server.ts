import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { packBundle, sha256 } from '@versiondrift/feed';
import { feedDir } from '$lib/server/feed-sync';
import { mode } from '$lib/server/storage';
import type { RequestHandler } from './$types';

// The offline feed package of this instance's copy (docs/07), at the same path as on feed.versiondrift.dev: an
// instance with Internet access can hand the feed to one without. Public data, like the rest of /feed/.
let cached: { index: string; bytes: Buffer; generatedAt: string } | undefined;

export const GET: RequestHandler = async () => {
  if (mode() !== 'selfhosted') error(404, 'Not found');
  const indexText = await readFile(path.join(feedDir(), 'v1/index.json'), 'utf8').catch(() => undefined);
  if (indexText === undefined) error(503, 'The feed has not been synced yet; try again in a minute');
  const index = sha256(indexText);
  if (cached?.index !== index) cached = { index, ...(await packBundle(feedDir())) };
  return new Response(new Uint8Array(cached.bytes), {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="versiondrift-feed-${cached.generatedAt.slice(0, 10)}.tar.gz"`,
      'cache-control': 'no-cache',
      etag: `"${index.slice(0, 32)}"`,
    },
  });
};
