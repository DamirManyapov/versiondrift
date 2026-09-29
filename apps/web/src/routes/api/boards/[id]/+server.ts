import { error } from '@sveltejs/kit';
import { attempt, body, boardId, nameOf, noContent } from '$lib/server/api';
import { selfHostedStorage, selfHostedStore } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const store = selfHostedStore();
  const name = nameOf(await body(request));
  attempt(() => store.renameBoard(boardId(params.id), name));
  return noContent();
};

/** A board that is a site with hosts is not deleted: its hosts would go with it. Move or delete them first. */
export const DELETE: RequestHandler = ({ params }) => {
  const id = boardId(params.id);
  const { store, fleet } = selfHostedStorage();
  const hosts = fleet.hosts(id).length;
  if (hosts > 0) error(400, `The site has ${hosts} host(s): move them to another site or delete them first`);
  attempt(() => store.deleteBoard(id));
  return noContent();
};
