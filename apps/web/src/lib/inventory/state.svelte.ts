// The board's inventory as reactive state; every change is saved through the store. Public site: one board in
// localStorage. Self-hosted (docs/07): several boards on the server, one of them open.
import {
  addProduct,
  DEMO_ITEMS,
  removeItem,
  updateItem,
  type InventoryData,
  type InventoryItem,
  type InventorySettings,
} from './model.ts';
import { boardsApi, RemoteInventoryStore, type BoardSummary } from './remote.ts';
import { BrowserInventoryStore, type InventoryStore } from './store.ts';

export type Mode = 'public' | 'selfhosted';

const BOARD_KEY = 'vd.board';

export class InventoryState {
  data = $state<InventoryData>({ v: 1, items: [], settings: { criticalCvss: 7, hideOk: false } });
  persistent = $state(true);
  loaded = $state(false);
  /** Showing the sample stack of a first visit; the first edit makes it the user's board. */
  demo = $state(false);
  /** Self-hosted: the instance's boards and the open one. */
  boards = $state<BoardSummary[]>([]);
  boardId = $state<number | undefined>();
  /** Self-hosted: the last load or save failed (message for a banner). */
  serverError = $state<string | undefined>();
  private store: InventoryStore | undefined;
  private started = false;
  /** Edits made before the board finished loading (self-hosted loads asynchronously); applied right after. */
  private queued: (() => void)[] = [];
  private modeOf: () => Mode = () => 'public';

  /** Called by the root layout before any page initializes, with the server's VD_MODE. */
  configure(mode: () => Mode): void {
    this.modeOf = mode;
  }

  get mode(): Mode {
    return this.modeOf();
  }

  /** Call in the browser (onMount); the server never sees a public visitor's inventory. Runs once per page load. */
  init(store?: InventoryStore): void {
    if (this.started) return;
    this.started = true;
    if (!store && this.mode === 'selfhosted') {
      void this.initServer();
      return;
    }
    const local = store ?? new BrowserInventoryStore();
    this.store = local;
    this.data = local.load() as InventoryData;
    this.demo = !local.hasSaved() && this.data.items.length === 0;
    if (this.demo) this.data = { ...this.data, items: DEMO_ITEMS.map((item) => ({ ...item })) };
    this.persistent = local.persistent;
    this.ready();
  }

  private ready(): void {
    this.loaded = true;
    for (const edit of this.queued.splice(0)) edit();
  }

  private async initServer(): Promise<void> {
    try {
      this.boards = await boardsApi.list();
      let remembered: number | undefined;
      try {
        remembered = Number(localStorage.getItem(BOARD_KEY)) || undefined;
      } catch {
        remembered = undefined;
      }
      const board = this.boards.find((b) => b.id === remembered) ?? this.boards[0];
      if (board) await this.openBoard(board.id);
    } catch (error) {
      this.serverError = (error as Error).message;
    }
  }

  /** Self-hosted: switch to another board. */
  async openBoard(id: number): Promise<void> {
    const store = new RemoteInventoryStore(id);
    store.onerror = (error) => (this.serverError = error.message);
    const data = await store.load();
    this.store = store;
    this.boardId = id;
    this.data = data;
    this.demo = false;
    this.persistent = true;
    this.serverError = undefined;
    this.ready();
    try {
      localStorage.setItem(BOARD_KEY, String(id));
    } catch {
      // only a convenience
    }
  }

  async createBoard(name: string): Promise<void> {
    const board = await boardsApi.create(name);
    this.boards = await boardsApi.list();
    await this.openBoard(board.id);
  }

  async renameBoard(id: number, name: string): Promise<void> {
    await boardsApi.rename(id, name);
    this.boards = await boardsApi.list();
  }

  async deleteBoard(id: number): Promise<void> {
    await boardsApi.remove(id);
    this.boards = await boardsApi.list();
    if (id === this.boardId && this.boards[0]) await this.openBoard(this.boards[0].id);
  }

  /** Applies an edit to the current data now, or once the board has loaded. */
  private commit(next: () => InventoryData): void {
    if (!this.loaded) {
      this.queued.push(() => this.commit(next));
      return;
    }
    const data = next();
    this.demo = false;
    this.data = data;
    void this.store?.save($state.snapshot(data));
    this.persistent = this.store?.persistent ?? false;
  }

  add(p: string, ver?: string): void {
    this.commit(() => addProduct(this.data, p, ver));
  }
  update(index: number, patch: Partial<Omit<InventoryItem, 'p'>>): void {
    this.commit(() => updateItem(this.data, index, patch));
  }
  remove(index: number): void {
    this.commit(() => removeItem(this.data, index));
  }
  /** Leaves the demo: an empty board of one's own. */
  startOwn(): void {
    this.commit(() => ({ ...this.data, items: [] }));
  }
  replaceItems(items: InventoryItem[]): void {
    this.commit(() => ({ ...this.data, items }));
  }
  setSettings(patch: Partial<InventorySettings>): void {
    this.commit(() => ({ ...this.data, settings: { ...this.data.settings, ...patch } }));
  }
}

export const inventory = new InventoryState();
