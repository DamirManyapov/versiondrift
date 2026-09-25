import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS, openStorage, StoreError } from '../src/index.ts';

describe('migrations', () => {
  it('apply once, in order, and are recorded', () => {
    const sqlite = new Database(':memory:');
    expect(migrate(sqlite)).toEqual(MIGRATIONS.map((m) => m.tag));
    expect(migrate(sqlite)).toEqual([]);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(['boards', 'instances', 'settings', 'vd_migrations']));
  });
});

describe('BoardStore', () => {
  it('always has a default board and keeps items in order, losslessly', () => {
    const { store } = openStorage(':memory:');
    const main = store.defaultBoard();
    expect(main.name).toBe('Main');
    expect(store.defaultBoard()).toEqual(main);
    const items = [
      { p: 'grafana', ver: '12.4.5', label: 'mon-01' },
      { p: 'grafana', ver: '11.6.4', track: '11', label: 'legacy' },
      { p: 'debian' },
    ];
    store.replaceItems(main.id, items);
    expect(store.items(main.id)).toEqual(items);
    store.replaceItems(main.id, [{ p: 'nginx', ver: '1.30.1' }]);
    expect(store.items(main.id)).toEqual([{ p: 'nginx', ver: '1.30.1' }]);
    expect(store.items(999)).toBeUndefined();
  });

  it('manages several boards; names are unique and the last board stays', () => {
    const { store } = openStorage(':memory:');
    const main = store.defaultBoard();
    const lab = store.createBoard(' Homelab ');
    expect(store.boards().map((b) => b.name)).toEqual(['Main', 'Homelab']);
    expect(() => store.createBoard('homelab')).toThrow(StoreError);
    expect(() => store.createBoard('  ')).toThrow(StoreError);
    store.renameBoard(lab.id, 'Lab');
    store.replaceItems(lab.id, [{ p: 'proxmox-ve', ver: '9.0' }]);
    store.deleteBoard(lab.id);
    expect(store.boards()).toEqual([main]);
    expect(() => store.deleteBoard(main.id)).toThrow(/last board/);
    expect(() => store.replaceItems(lab.id, [])).toThrow(StoreError);
  });

  it('stores settings as JSON values', () => {
    const { store } = openStorage(':memory:');
    store.setSettings({ criticalCvss: 8.5, hideOk: true });
    store.setSettings({ hideOk: false });
    expect(store.settings()).toEqual({ criticalCvss: 8.5, hideOk: false });
  });

  it('persists in a file across opens', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'vd-db-')), 'versiondrift.db');
    const first = openStorage(file);
    first.store.replaceItems(first.store.defaultBoard().id, [{ p: 'zabbix', ver: '7.0.20' }]);
    first.close();
    const second = openStorage(file);
    expect(second.store.items(second.store.defaultBoard().id)).toEqual([{ p: 'zabbix', ver: '7.0.20' }]);
    second.close();
  });
});
