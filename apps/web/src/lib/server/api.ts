// Small helpers for the self-hosted JSON API (/api/boards…).
import { error, json } from '@sveltejs/kit';
import { StoreError } from '@versiondrift/db';

/** Runs a store operation; StoreError (bad name, unknown board, last board) becomes a 400 with its message. */
export function attempt<T>(operation: () => T): T {
  try {
    return operation();
  } catch (e) {
    if (e instanceof StoreError) error(400, e.message);
    throw e;
  }
}

export function boardId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) error(404, 'Unknown board');
  return id;
}

export async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    error(400, 'Expected a JSON body');
  }
}

export const nameOf = (value: unknown): string =>
  typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string'
    ? (value as { name: string }).name
    : '';

export const noContent = () => new Response(null, { status: 204 });
export { json };
