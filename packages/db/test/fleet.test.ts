import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStorage, seedFleetDemo, type FleetDemo, type Storage } from '../src/index.ts';

const demo = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../../../fixtures/fleet-demo.json'), 'utf8'),
) as FleetDemo;

function seeded(): Storage {
  const storage = openStorage(':memory:');
  storage.store.defaultBoard();
  expect(seedFleetDemo(storage, demo)).toBe(true);
  return storage;
}
const byName = (storage: Storage, name: string) => storage.fleet.hosts().find((h) => h.name === name)!;

describe('demo fleet seed', () => {
  it('creates the sites, profiles and 31 hosts, replacing the empty default board', () => {
    const storage = seeded();
    expect(storage.store.boards().map((b) => b.name)).toEqual(['Москва, ЦОД', 'Казань, филиал']);
    expect(storage.fleet.hosts()).toHaveLength(31);
    expect(storage.fleet.profiles().map((p) => [p.name, p.kind, p.hosts, p.hasSecret])).toContainEqual([
      'Linux SSH (только чтение)',
      'ssh-linux',
      10,
      true,
    ]);
    expect(seedFleetDemo(storage, demo)).toBe(false);
  });

  it('keeps the last known versions of hosts that fail, with the state and since', () => {
    const storage = seeded();
    expect(byName(storage, 'kzn-fs-01')).toMatchObject({
      poll: {
        state: 'auth-failed',
        since: '2026-09-25T05:00:00Z',
        lastAttemptAt: '2026-09-28T05:00:00Z',
        errorCode: 'password_expired',
      },
      instances: [{ productId: 'windows-server', version: '20348.5386', track: '2022', source: 'detected' }],
    });
    expect(byName(storage, 'kzn-gw-02').poll).toMatchObject({
      state: 'unreachable',
      since: '2026-09-26T07:10:00Z',
    });
    const history = storage.fleet.host(byName(storage, 'kzn-gw-02').id)!.events;
    expect(history).toEqual([
      expect.objectContaining({ kind: 'poll', pollState: 'unreachable', message: 'Перестал отвечать' }),
    ]);
    expect(storage.fleet.host(byName(storage, 'msk-db-02').id)!.events).toEqual([
      expect.objectContaining({
        kind: 'version',
        productId: 'debian',
        fromVersion: '12.14',
        toVersion: '12.15',
      }),
    ]);
  });

  it('maps the fixture ids to module and track ids', () => {
    const storage = seeded();
    expect(byName(storage, 'kzn-app-01').instances.map((i) => [i.productId, i.track, i.label])).toEqual([
      ['debian', '12', null],
      ['docker-engine', '29', null],
      ['zabbix', '7.0', 'Zabbix proxy'],
    ]);
    expect(byName(storage, 'msk-gw-01').instances[0]).toMatchObject({
      productId: 'routeros',
      track: '7-long-term',
    });
  });
});

describe('FleetStore', () => {
  it('records polls: version changes and state changes become history, manual products stay', () => {
    const storage = seeded();
    const host = byName(storage, 'kzn-gw-02');
    storage.fleet.addManual(host.id, 'netdata', '2.6.0');
    storage.fleet.recordPoll(host.id, {
      ok: true,
      at: '2026-09-28T11:00:00Z',
      found: [{ productId: 'routeros', version: '7.23.7', track: '7-long-term' }],
    });
    const after = storage.fleet.host(host.id)!;
    expect(after.poll).toMatchObject({ state: 'ok', since: '2026-09-28T11:00:00Z', errorCode: null });
    expect(after.instances.map((i) => [i.productId, i.version, i.source])).toEqual([
      ['netdata', '2.6.0', 'manual'],
      ['routeros', '7.23.7', 'detected'],
    ]);
    expect(after.events.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'poll', pollState: 'ok' }),
        expect.objectContaining({ kind: 'version', fromVersion: '7.23.4', toVersion: '7.23.7' }),
      ]),
    );
  });

  it('keeps fleet products out of the board inventory, and a board save does not touch them', () => {
    const storage = seeded();
    const site = storage.store.boards()[0]!;
    expect(storage.store.items(site.id)).toEqual([]);
    storage.store.replaceItems(site.id, [{ p: 'grafana', ver: '12.1.1' }]);
    expect(storage.store.items(site.id)).toEqual([{ p: 'grafana', ver: '12.1.1' }]);
    expect(byName(storage, 'msk-app-01').instances).toHaveLength(2);
  });

  it('never returns secrets; the poller gets them unsealed', () => {
    const storage = seeded();
    const profile = storage.fleet.profiles()[0]!;
    expect(JSON.stringify(storage.fleet.profiles())).not.toContain('demo');
    expect(storage.fleet.profileCredentials(profile.id).secret).toBe('demo');
    storage.fleet.setProfileSecret(profile.id, 'new');
    expect(storage.fleet.profileCredentials(profile.id).secret).toBe('new');
  });

  it('moves, re-profiles and deletes hosts with their products and history', () => {
    const storage = seeded();
    const [msk, kzn] = storage.store.boards();
    const host = byName(storage, 'msk-db-02');
    storage.fleet.moveHosts([host.id], kzn!.id);
    expect(byName(storage, 'msk-db-02').siteId).toBe(kzn!.id);
    expect(storage.fleet.hosts(msk!.id).some((h) => h.name === 'msk-db-02')).toBe(false);

    const windows = storage.fleet.profiles().find((p) => p.kind === 'windows')!;
    expect(() => storage.fleet.setProfile([host.id], windows.id)).toThrow(/for windows hosts/);
    storage.fleet.setProfile([host.id], null);
    expect(byName(storage, 'msk-db-02').poll.state).toBe('none');

    expect(storage.fleet.deleteHosts([host.id])).toBe(1);
    expect(storage.fleet.host(host.id)).toBeUndefined();
    expect(storage.fleet.hosts()).toHaveLength(30);
  });

  it('checks names, sites and duplicates on create', () => {
    const storage = seeded();
    const site = storage.store.boards()[0]!.id;
    expect(() =>
      storage.fleet.createHost({ name: 'bad name', address: 'x', kind: 'ssh-linux', siteId: site }),
    ).toThrow(/not a host name/);
    expect(() =>
      storage.fleet.createHost({ name: 'msk-app-01', address: 'x', kind: 'ssh-linux', siteId: site }),
    ).toThrow(/already exists/);
    const created = storage.fleet.createHost({
      name: 'new-01',
      address: '10.0.0.9',
      kind: 'ssh-linux',
      siteId: site,
    });
    expect(created.poll.state).toBe('none');
  });
});
