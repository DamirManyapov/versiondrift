import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'vd-inv-'));
vi.mock('$env/dynamic/private', () => ({ env: { VD_MODE: 'selfhosted', VD_DATA_DIR: dataDir } }));

const { importInventoryFile, inventoryFile } = await import('../src/lib/server/inventory-file.ts');
const { selfHostedStorage } = await import('../src/lib/server/storage.ts');

describe('inventory.yaml', () => {
  it('creates and replaces the boards it names, once per change, leaving other boards alone', async () => {
    const { store } = selfHostedStorage();
    const main = store.defaultBoard();
    store.replaceItems(main.id, [{ p: 'debian', ver: '12.15' }]);
    const file = inventoryFile();
    expect(file).toBe(path.join(dataDir, 'inventory.yaml'));
    expect(await importInventoryFile()).toBeUndefined();

    writeFileSync(
      file,
      `boards:\n  prod:\n    products:\n      grafana: [{ version: "11.3.1", host: mon-01 }, { version: "12.1.1", host: mon-02 }]\n      poste-io: "2.4.5"\n`,
    );
    expect(await importInventoryFile()).toEqual({ boards: ['prod'], items: 3 });
    const prod = store.boards().find((b) => b.name === 'prod')!;
    expect(store.items(prod.id)).toEqual([
      { p: 'grafana', ver: '11.3.1', label: 'mon-01' },
      { p: 'grafana', ver: '12.1.1', label: 'mon-02' },
      { p: 'poste-io', ver: '2.4.5' },
    ]);
    expect(store.items(main.id)).toEqual([{ p: 'debian', ver: '12.15' }]);

    // Unchanged file: a UI edit survives.
    store.replaceItems(prod.id, [{ p: 'grafana', ver: '12.1.1' }]);
    expect(await importInventoryFile()).toBeUndefined();
    expect(store.items(prod.id)).toEqual([{ p: 'grafana', ver: '12.1.1' }]);

    writeFileSync(file, 'boards:\n  prod:\n    products:\n      grafana: 12.1\n');
    await expect(importInventoryFile()).rejects.toThrow(/quote versions/);
    expect(store.items(prod.id)).toEqual([{ p: 'grafana', ver: '12.1.1' }]);
  });
});
