import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  joinAddress,
  openStorage,
  schema,
  seedFleetDemo,
  splitAddress,
  type FleetDemo,
  type Storage,
} from '../src/index.ts';

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

  it('takes a non-standard port with the address, and drops it when the address comes without one', () => {
    const storage = seeded();
    const site = storage.store.boards()[0]!.id;
    const host = storage.fleet.createHost({
      name: 'app-07',
      address: ' 10.20.30.40:2026 ',
      kind: 'ssh-linux',
      siteId: site,
    });
    expect(host).toMatchObject({ address: '10.20.30.40', port: 2026 });
    storage.fleet.setAddress(host.id, 'app-07.lan');
    expect(byName(storage, 'app-07')).toMatchObject({ address: 'app-07.lan', port: null });
    expect(() =>
      storage.fleet.createHost({ name: 'p-1', address: 'x:70000', kind: 'ssh-linux', siteId: site }),
    ).toThrow(/out of range/);
  });
});

describe('products typed by hand on a host', () => {
  it('adds one, changes its version, keeps it through polls and removes it', () => {
    const storage = seeded();
    const { id } = byName(storage, 'msk-app-01');
    const manual = () => byName(storage, 'msk-app-01').instances.filter((i) => i.source === 'manual');
    storage.fleet.setManual(id, 'zabbix', ' v7.0.5 ');
    expect(manual()).toMatchObject([{ productId: 'zabbix', version: '7.0.5' }]);
    storage.fleet.setManual(id, 'zabbix', '7.0.6');
    expect(manual()).toMatchObject([{ productId: 'zabbix', version: '7.0.6' }]);
    storage.fleet.recordPoll(id, {
      ok: true,
      at: '2026-09-30T10:00:00Z',
      found: [{ productId: 'debian', version: '12.12' }],
    });
    expect(manual()).toHaveLength(1);
    expect(() => storage.fleet.setManual(id, 'Zabbix Server', '7')).toThrow(/not a product id/);
    expect(() => storage.fleet.setManual(id, 'zabbix', ' ')).toThrow(/version is needed/);
    expect(storage.fleet.removeManual(id, 'zabbix')).toBe(true);
    expect(storage.fleet.removeManual(id, 'zabbix')).toBe(false);
    expect(manual()).toHaveLength(0);
  });
});

describe('host address changes', () => {
  it('re-reads an address stored with its port; a new address forgets the pins and the old problem', () => {
    const storage = seeded();
    const { id } = byName(storage, 'msk-app-01');
    storage.db
      .update(schema.hosts)
      .set({
        address: '10.20.30.40:2026',
        port: null,
        hostKey: 'ssh-ed25519 AAAA',
        pollState: 'unreachable',
      })
      .where(eq(schema.hosts.id, id))
      .run();
    expect(storage.fleet.normalizeAddresses()).toBe(1);
    expect(byName(storage, 'msk-app-01')).toMatchObject({
      address: '10.20.30.40',
      port: 2026,
      pins: { hostKey: null },
      poll: { state: 'pending', errorCode: null },
    });
    expect(storage.fleet.normalizeAddresses()).toBe(0);

    // The same address again changes nothing (the pins stay).
    storage.db.update(schema.hosts).set({ hostKey: 'ssh-ed25519 BBBB' }).where(eq(schema.hosts.id, id)).run();
    storage.fleet.setAddress(id, '10.20.30.40:2026');
    expect(byName(storage, 'msk-app-01').pins.hostKey).toBe('ssh-ed25519 BBBB');
  });
});

describe('host addresses', () => {
  it('split "host:port", bracketed and bare IPv6, and join back', () => {
    expect(splitAddress('10.0.0.5')).toEqual({ address: '10.0.0.5', port: null });
    expect(splitAddress('pve.lan:8006')).toEqual({ address: 'pve.lan', port: 8006 });
    expect(splitAddress('[fe80::1]:2222')).toEqual({ address: 'fe80::1', port: 2222 });
    expect(splitAddress('[fe80::1]')).toEqual({ address: 'fe80::1', port: null });
    expect(splitAddress('fe80::1')).toEqual({ address: 'fe80::1', port: null });
    expect(() => splitAddress('host:ssh')).toThrow(/must be a number/);
    expect(() => splitAddress('host:0')).toThrow(/out of range/);
    expect(joinAddress('10.0.0.5', null)).toBe('10.0.0.5');
    expect(joinAddress('10.0.0.5', 2026)).toBe('10.0.0.5:2026');
    expect(joinAddress('fe80::1', 2222)).toBe('[fe80::1]:2222');
  });
});

describe('SSH key profiles', () => {
  it('keeps the private key sealed and shows the public key', () => {
    const storage = openStorage(':memory:');
    const profile = storage.fleet.createProfile({
      name: 'Linux',
      kind: 'ssh-linux',
      username: 'versiondrift',
      keyPair: {
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n',
        publicKey: 'ssh-ed25519 AAAA versiondrift',
      },
    });
    expect(profile).toMatchObject({ hasSecret: true, publicKey: 'ssh-ed25519 AAAA versiondrift' });
    expect(storage.fleet.profileCredentials(profile.id).privateKey).toContain('OPENSSH PRIVATE KEY');
    expect(JSON.stringify(storage.fleet.profiles())).not.toContain('PRIVATE');
  });
});

describe('pins (trust on first use)', () => {
  it('stores the first host key and keeps it; a reset forgets it', () => {
    const storage = openStorage(':memory:');
    const site = storage.store.defaultBoard().id;
    const host = storage.fleet.createHost({ name: 'h1', address: '10.0.0.1', kind: 'windows', siteId: site });
    const poll = (hostKey: string) =>
      storage.fleet.recordPoll(host.id, {
        ok: true,
        at: '2026-09-28T10:00:00Z',
        found: [],
        pins: { hostKey },
      });
    poll('SHA256:first');
    poll('SHA256:second');
    expect(storage.fleet.host(host.id)!.pins).toEqual({ hostKey: 'SHA256:first', tlsFingerprint: null });
    storage.fleet.resetPins(host.id);
    expect(storage.fleet.host(host.id)!.pins.hostKey).toBeNull();
  });
});
