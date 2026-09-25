// Self-hosted mode: the inventory lives on the server (/api/boards…, docs/07) instead of in localStorage.
import { sanitize, type InventoryData } from './model.ts';
import type { InventoryStore } from './store.ts';

export interface BoardSummary {
  id: number;
  name: string;
}

export class ApiError extends Error {
  override name = 'ApiError';
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // plain-text error
    }
    throw new ApiError(message || `HTTP ${response.status}`);
  }
  return response;
}

export const boardsApi = {
  async list(): Promise<BoardSummary[]> {
    return ((await (await call('/api/boards')).json()) as { boards: BoardSummary[] }).boards;
  },
  async create(name: string): Promise<BoardSummary> {
    return (await (
      await call('/api/boards', { method: 'POST', body: JSON.stringify({ name }) })
    ).json()) as BoardSummary;
  },
  async rename(id: number, name: string): Promise<void> {
    await call(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  },
  async remove(id: number): Promise<void> {
    await call(`/api/boards/${id}`, { method: 'DELETE' });
  },
};

/** One board on the server. Saves are sent in order, one at a time; the newest pending save wins. */
export class RemoteInventoryStore implements InventoryStore {
  readonly persistent = true;
  readonly boardId: number;
  private pending: InventoryData | undefined;
  private running: Promise<void> | undefined;
  onerror: ((error: Error) => void) | undefined;

  constructor(boardId: number) {
    this.boardId = boardId;
  }

  hasSaved(): boolean {
    return true;
  }

  async load(): Promise<InventoryData> {
    return sanitize(await (await call(`/api/boards/${this.boardId}/inventory`)).json());
  }

  save(data: InventoryData): Promise<void> {
    this.pending = data;
    this.running ??= this.flush().finally(() => (this.running = undefined));
    return this.running;
  }

  private async flush(): Promise<void> {
    while (this.pending) {
      const data = this.pending;
      this.pending = undefined;
      try {
        await call(`/api/boards/${this.boardId}/inventory`, { method: 'PUT', body: JSON.stringify(data) });
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }
}
