import { attempt, body, json, nameOf } from '$lib/server/api';
import { selfHostedStore } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** Boards of this instance, in order; the first request creates "Main". */
export const GET: RequestHandler = () => {
  const store = selfHostedStore();
  store.defaultBoard();
  return json({ boards: store.boards() });
};

export const POST: RequestHandler = async ({ request }) => {
  const store = selfHostedStore();
  const name = nameOf(await body(request));
  return json(
    attempt(() => store.createBoard(name)),
    { status: 201 },
  );
};
