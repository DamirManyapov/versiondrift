import { describe, expect, it } from 'vitest';
import {
  addProduct,
  emptyInventory,
  fromYaml,
  InventoryImportError,
  removeItem,
  sanitize,
  toYaml,
  updateItem,
} from '../src/lib/inventory/model.ts';
import { BrowserInventoryStore, STORAGE_KEY } from '../src/lib/inventory/store.ts';

class MemoryStorage {
  map = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(key, value);
  }
}
const storage = (s: MemoryStorage) => s as unknown as Storage;

describe('inventory model', () => {
  it('adds products (no duplicates), updates and removes items', () => {
    let data = addProduct(emptyInventory(), 'grafana', '12.4.5');
    data = addProduct(data, 'grafana', '12.4.5');
    data = addProduct(data, 'zabbix');
    expect(data.items).toEqual([{ p: 'grafana', ver: '12.4.5' }, { p: 'zabbix' }]);
    data = updateItem(data, 1, { ver: '7.0.31', label: 'zbx-01' });
    data = updateItem(data, 0, { ver: '' });
    expect(data.items).toEqual([{ p: 'grafana' }, { p: 'zabbix', ver: '7.0.31', label: 'zbx-01' }]);
    expect(removeItem(data, 0).items).toEqual([{ p: 'zabbix', ver: '7.0.31', label: 'zbx-01' }]);
  });

  it('repairs whatever is found in storage', () => {
    expect(sanitize('garbage')).toEqual(emptyInventory());
    expect(
      sanitize({
        items: [{ p: 'grafana', ver: 12 }, { ver: '1' }, null],
        settings: { criticalCvss: 42, hideOk: true },
      }),
    ).toEqual({
      v: 1,
      items: [{ p: 'grafana' }],
      settings: { criticalCvss: 7, hideOk: true },
    });
  });

  it('round-trips through inventory.yaml, quoting versions', () => {
    const data = {
      ...emptyInventory(),
      items: [
        { p: 'grafana', ver: '12.10', label: 'prod' },
        { p: 'debian', ver: '13.7', track: '13' },
        { p: 'zabbix' },
      ],
    };
    const yaml = toYaml(data);
    expect(yaml).toContain('"12.10"');
    expect(fromYaml(yaml)).toEqual([
      { p: 'grafana', ver: '12.10', label: 'prod' },
      { p: 'debian', ver: '13.7', track: '13' },
    ]);
  });

  it('imports the self-hosted format with several boards and hosts', () => {
    const yaml =
      'boards:\n  prod:\n    products:\n      grafana: [{ version: "11.3.1", host: mon-01 }]\n  lab:\n    products:\n      poste-io: "2.5.17"\n';
    expect(fromYaml(yaml)).toEqual([
      { p: 'grafana', ver: '11.3.1', label: 'mon-01' },
      { p: 'poste-io', ver: '2.5.17' },
    ]);
  });

  it('explains what is wrong with a bad file', () => {
    expect(() => fromYaml('boards: [')).toThrow(InventoryImportError);
    expect(() => fromYaml('boards:\n  a:\n    products:\n      debian: 12.10\n')).toThrow(/quote versions/);
  });
});

describe('BrowserInventoryStore', () => {
  it('persists to localStorage under vd.inventory.v1', () => {
    const s = new MemoryStorage();
    const store = new BrowserInventoryStore(storage(s));
    store.save(addProduct(emptyInventory(), 'grafana', '1.0.0'));
    expect(JSON.parse(s.map.get(STORAGE_KEY)!)).toMatchObject({
      v: 1,
      items: [{ p: 'grafana', ver: '1.0.0' }],
    });
    expect(new BrowserInventoryStore(storage(s)).load().items).toHaveLength(1);
  });

  it('keeps working in memory when storage fails, and says so', () => {
    const s = new MemoryStorage();
    s.failWrites = true;
    const store = new BrowserInventoryStore(storage(s));
    store.save(addProduct(emptyInventory(), 'grafana'));
    expect(store.persistent).toBe(false);
    expect(store.load().items).toEqual([{ p: 'grafana' }]);
    expect(new BrowserInventoryStore(null).persistent).toBe(false);
  });
});

describe('demo board', async () => {
  const { InventoryState } = await import('../src/lib/inventory/state.svelte.ts');
  it('is shown on a first visit and becomes the user board on the first edit', () => {
    const s = new MemoryStorage();
    const state = new InventoryState();
    state.init(new BrowserInventoryStore(storage(s)));
    expect(state.demo).toBe(true);
    expect(state.data.items.length).toBeGreaterThan(3);
    expect(s.map.size).toBe(0);
    state.update(0, { ver: '1.0.0' });
    expect(state.demo).toBe(false);
    expect((JSON.parse(s.map.get(STORAGE_KEY)!) as { items: unknown[] }).items.length).toBeGreaterThan(3);
    const again = new InventoryState();
    again.init(new BrowserInventoryStore(storage(s)));
    expect(again.demo).toBe(false);
  });
});

describe('self-hosted mode', async () => {
  const { InventoryState } = await import('../src/lib/inventory/state.svelte.ts');
  const { vi } = await import('vitest');

  /** A tiny in-memory /api/boards… server. */
  function server() {
    const boards = [
      { id: 1, name: 'Main' },
      { id: 2, name: 'Lab' },
    ];
    const inventories: Record<number, unknown> = {
      1: { v: 1, items: [{ p: 'grafana', ver: '12.4.5' }], settings: { criticalCvss: 7, hideOk: false } },
      2: { v: 1, items: [{ p: 'proxmox-ve', ver: '9.0' }], settings: { criticalCvss: 7, hideOk: false } },
    };
    const puts: { id: number; body: unknown }[] = [];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/boards') return Promise.resolve(Response.json({ boards }));
      const m = /^\/api\/boards\/(\d+)\/inventory$/.exec(url);
      if (m) {
        const id = Number(m[1]);
        if (init?.method === 'PUT') {
          puts.push({ id, body: JSON.parse(init.body as string) });
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(Response.json(inventories[id]));
      }
      return Promise.resolve(new Response('nope', { status: 404 }));
    });
    return { fetch, puts };
  }

  it('loads the remembered board from the server, saves edits there, and switches boards', async () => {
    const { fetch, puts } = server();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', { getItem: () => '2', setItem: () => {} });
    const state = new InventoryState();
    state.configure(() => 'selfhosted');
    state.init();
    await vi.waitFor(() => expect(state.loaded).toBe(true));
    expect(state.boardId).toBe(2);
    expect(state.demo).toBe(false);
    expect(state.data.items).toEqual([{ p: 'proxmox-ve', ver: '9.0' }]);

    state.update(0, { ver: '9.1' });
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ id: 2, body: { items: [{ p: 'proxmox-ve', ver: '9.1' }] } });

    await state.openBoard(1);
    expect(state.data.items).toEqual([{ p: 'grafana', ver: '12.4.5' }]);
    vi.unstubAllGlobals();
  });

  it('keeps edits made while the board is still loading', async () => {
    const { fetch, puts } = server();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const state = new InventoryState();
    state.configure(() => 'selfhosted');
    state.init();
    state.add('nginx', '1.30.1');
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(state.data.items).toEqual([
      { p: 'grafana', ver: '12.4.5' },
      { p: 'nginx', ver: '1.30.1' },
    ]);
    expect(puts[0]?.id).toBe(1);
    vi.unstubAllGlobals();
  });

  it('reports a server that fails to save', async () => {
    const { fetch } = server();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? Promise.resolve(new Response('disk full', { status: 500 })) : fetch(url, init),
    );
    const state = new InventoryState();
    state.configure(() => 'selfhosted');
    state.init();
    await vi.waitFor(() => expect(state.loaded).toBe(true));
    state.add('nginx', '1.30.1');
    await vi.waitFor(() => expect(state.serverError).toBe('disk full'));
    vi.unstubAllGlobals();
  });
});
