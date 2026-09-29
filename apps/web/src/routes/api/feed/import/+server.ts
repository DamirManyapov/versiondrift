import { importPackage } from '$lib/server/feed-sync';
import { json } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** An offline feed package (docs/07), the file itself as the body. A refused package is a 400 with the reason. */
export const POST: RequestHandler = async ({ request }) => {
  selfHostedStorage();
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return json({ message: 'The upload is empty' }, { status: 400 });
  try {
    const { changed, state } = await importPackage(bytes);
    return json({ changed, state });
  } catch (error) {
    return json({ message: (error as Error).message }, { status: 400 });
  }
};
