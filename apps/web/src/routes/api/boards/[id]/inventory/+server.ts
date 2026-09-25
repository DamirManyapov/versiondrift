import { error } from '@sveltejs/kit';
import { attempt, body, boardId, json, noContent } from '$lib/server/api';
import { selfHostedStore } from '$lib/server/storage';
import { sanitize, type InventoryData } from '$lib/inventory/model';
import type { RequestHandler } from './$types';

// The board in the web app's inventory format (docs/06 "Inventory storage"); settings are instance-wide.
export const GET: RequestHandler = ({ params }) => {
  const store = selfHostedStore();
  const items = store.items(boardId(params.id));
  if (!items) error(404, 'Unknown board');
  const data: InventoryData = sanitize({ items, settings: store.settings() });
  return json(data);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const store = selfHostedStore();
  const id = boardId(params.id);
  const data = sanitize(await body(request));
  attempt(() => store.replaceItems(id, data.items));
  store.setSettings({ ...data.settings });
  return noContent();
};
