import { emptyInventory, sanitize, type InventoryData } from './model.ts';

export const STORAGE_KEY = 'vd.inventory.v1';

/** Where the inventory lives (docs/01): the browser here, the server's SQLite in self-hosted mode (remote.ts). */
export interface InventoryStore {
  /** False when changes will be lost on reload (storage blocked): the UI shows a banner. */
  readonly persistent: boolean;
  /** True once something was saved (so a first visit can show the demo board). */
  hasSaved(): boolean;
  load(): InventoryData | Promise<InventoryData>;
  save(data: InventoryData): void | Promise<void>;
}

/** localStorage, every access guarded; falls back to memory when storage is unavailable or full. */
export class BrowserInventoryStore implements InventoryStore {
  persistent: boolean;
  private memory: InventoryData | undefined;
  private readonly storage: Storage | undefined;

  constructor(storage?: Storage | null) {
    let usable: Storage | undefined;
    try {
      usable = storage === undefined ? globalThis.localStorage : (storage ?? undefined);
      usable?.getItem(STORAGE_KEY);
    } catch {
      usable = undefined;
    }
    this.storage = usable;
    this.persistent = usable !== undefined;
  }

  hasSaved(): boolean {
    if (this.memory) return true;
    try {
      return this.storage?.getItem(STORAGE_KEY) != null;
    } catch {
      return false;
    }
  }

  load(): InventoryData {
    if (this.memory) return this.memory;
    try {
      const text = this.storage?.getItem(STORAGE_KEY);
      return text ? sanitize(JSON.parse(text)) : emptyInventory();
    } catch {
      return emptyInventory();
    }
  }

  save(data: InventoryData): void {
    try {
      if (!this.storage) throw new Error('no storage');
      this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.memory = undefined;
    } catch {
      this.persistent = false;
      this.memory = data;
    }
  }
}
