import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseLinuxInventory,
  parseProxmoxVersion,
  parseRouterOs,
  parseWindowsVer,
  upstreamVersion,
} from '../src/index.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('Linux inventory', () => {
  it('Debian: the point release from debian_version, packages that are products, newest major, no removed ones', () => {
    expect(parseLinuxInventory(fixture('linux-debian12.txt'))).toEqual([
      { productId: 'debian', version: '12.12' },
      { productId: 'docker-engine', version: '29.7.2' },
      { productId: 'postgresql', version: '16.10' },
      { productId: 'zabbix', version: '7.0.29', label: 'Zabbix proxy' },
      { productId: 'containerd', version: '1.7.28' },
    ]);
  });

  it('Ubuntu: the point release from VERSION', () => {
    expect(parseLinuxInventory(fixture('linux-ubuntu2404.txt'))).toEqual([
      { productId: 'ubuntu', version: '24.04.3' },
      { productId: 'nginx', version: '1.24.0' },
    ]);
  });

  it('an unreadable Debian release is kept as read', () => {
    expect(parseLinuxInventory('### os-release\nID=debian\n### debian_version\ntrixie/sid\n')).toEqual([
      { productId: 'debian', version: null, readRaw: 'debian_version: trixie/sid' },
    ]);
  });

  it('upstream versions drop the epoch and the packaging revision', () => {
    expect(
      ['5:29.8.1-1~debian.12~bookworm', '1:7.0.31-1+debian12', '16.4-1.pgdg120+1', 'x'].map(upstreamVersion),
    ).toEqual(['29.8.1', '7.0.31', '16.4', null]);
  });
});

describe('RouterOS', () => {
  it('reads the version and the update channel as the track', () => {
    expect(parseRouterOs(fixture('routeros-7.txt'))).toEqual([
      { productId: 'routeros', version: '7.23.7', track: '7-long-term' },
    ]);
    expect(parseRouterOs(fixture('routeros-6.txt'))).toEqual([
      { productId: 'routeros', version: '6.49.22', track: '6-long-term' },
    ]);
  });

  it('keeps what it read when there is no version line', () => {
    expect(parseRouterOs('bad command name resource')).toEqual([
      { productId: 'routeros', version: null, readRaw: 'bad command name resource' },
    ]);
  });
});

describe('Windows', () => {
  it('reads the build with its update revision from ver', () => {
    expect(parseWindowsVer(fixture('windows-ver.txt'))).toEqual([
      { productId: 'windows-server', version: '20348.5622' },
    ]);
  });
});

describe('Proxmox', () => {
  it('VE answers the pve-manager version; Backup Server version and release', () => {
    expect(
      parseProxmoxVersion({ data: { version: '9.2.20', release: '9.2', repoid: 'a1b2' } }, 'pve'),
    ).toEqual([{ productId: 'proxmox-ve', version: '9.2.20' }]);
    expect(parseProxmoxVersion({ data: { version: '4.2', release: '6', repoid: 'c3d4' } }, 'pbs')).toEqual([
      { productId: 'proxmox-backup-server', version: '4.2.6' },
    ]);
  });
});
