// The board's inventory as reactive state; every change is saved through the store.
import {
  addProduct,
  removeItem,
  updateItem,
  type InventoryData,
  type InventoryItem,
  type InventorySettings,
} from './model.ts';
import { BrowserInventoryStore, type InventoryStore } from './store.ts';

export class InventoryState {
  data = $state<InventoryData>({ v: 1, items: [], settings: { criticalCvss: 7, hideOk: false } });
  persistent = $state(true);
  loaded = $state(false);
  private store: InventoryStore | undefined;

  /** Call in the browser (onMount); the server never sees the inventory. */
  init(store: InventoryStore = new BrowserInventoryStore()): void {
    this.store = store;
    this.data = store.load();
    this.persistent = store.persistent;
    this.loaded = true;
  }

  private commit(next: InventoryData): void {
    this.data = next;
    this.store?.save($state.snapshot(next));
    this.persistent = this.store?.persistent ?? false;
  }

  add(p: string, ver?: string): void {
    this.commit(addProduct(this.data, p, ver));
  }
  update(index: number, patch: Partial<Omit<InventoryItem, 'p'>>): void {
    this.commit(updateItem(this.data, index, patch));
  }
  remove(index: number): void {
    this.commit(removeItem(this.data, index));
  }
  replaceItems(items: InventoryItem[]): void {
    this.commit({ ...this.data, items });
  }
  setSettings(patch: Partial<InventorySettings>): void {
    this.commit({ ...this.data, settings: { ...this.data.settings, ...patch } });
  }
}

export const inventory = new InventoryState();
