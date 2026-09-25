import { attempt, body, boardId, nameOf, noContent } from '$lib/server/api';
import { selfHostedStore } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const store = selfHostedStore();
  const name = nameOf(await body(request));
  attempt(() => store.renameBoard(boardId(params.id), name));
  return noContent();
};

export const DELETE: RequestHandler = ({ params }) => {
  const store = selfHostedStore();
  attempt(() => store.deleteBoard(boardId(params.id)));
  return noContent();
};
