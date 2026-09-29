import { describe, expect, it } from 'vitest';
import { applyImport, importRows, openStorage, parseCsv, planImport, type Storage } from '../src/index.ts';

function storage(): Storage {
  const s = openStorage(':memory:');
  s.store.createBoard('Москва, ЦОД');
  s.fleet.createProfile({ name: 'Linux SSH', kind: 'ssh-linux', username: 'versiondrift' });
  s.fleet.createProfile({ name: 'Windows RO', kind: 'windows', username: 'versiondrift', secret: 'x' });
  return s;
}

describe('parseCsv', () => {
  it('reads quoted fields with commas and escaped quotes, CRLF, a BOM, and skips blank lines', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n\r\nd,e,f\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['d', 'e', 'f'],
    ]);
  });
});

describe('host import', () => {
  const csv = [
    'name,address,site,profile',
    'msk-app-01,10.10.1.11,"Москва, ЦОД",Linux SSH',
    'kzn-1c-01,10.20.2.21,"Казань, филиал",Windows RO',
    'bad name,10.0.0.1,"Москва, ЦОД",Linux SSH',
    'msk-app-02,,"Москва, ЦОД",Linux SSH',
    'msk-app-03,10.10.1.13,"Москва, ЦОД",Nope',
    'msk-app-01,10.10.1.11,"Москва, ЦОД",Linux SSH',
    'lab-01,10.9.0.1,Lab,,ssh-linux',
  ].join('\n');

  it('dry run: new, errors with line numbers and reasons, new sites', () => {
    const plan = planImport(storage(), importRows(csv));
    expect(plan.map((r) => [r.line, r.name, r.result, r.reason ?? r.newSite ?? ''])).toEqual([
      [2, 'msk-app-01', 'new', ''],
      [3, 'kzn-1c-01', 'new', true],
      [4, 'bad name', 'error', '"bad name" is not a host name'],
      [5, 'msk-app-02', 'error', 'no address'],
      [6, 'msk-app-03', 'error', 'no access profile "Nope"'],
      [7, 'msk-app-01', 'error', '"msk-app-01" appears twice in the list'],
      [8, 'lab-01', 'new', true],
    ]);
  });

  it('imports the new rows, creating sites; a second run is an upsert by name', () => {
    const s = storage();
    const result = applyImport(s, planImport(s, importRows(csv)));
    expect(result.created).toHaveLength(3);
    expect(s.store.boards().map((b) => b.name)).toEqual(['Москва, ЦОД', 'Казань, филиал', 'Lab']);
    expect(s.fleet.hosts().find((h) => h.name === 'lab-01')).toMatchObject({
      kind: 'ssh-linux',
      profileId: null,
    });
    expect(s.fleet.hosts().find((h) => h.name === 'lab-01')!.poll.state).toBe('none');

    const again = planImport(
      s,
      importRows(
        'msk-app-01,10.10.1.99,"Москва, ЦОД",Linux SSH\nkzn-1c-01,10.20.2.21,"Казань, филиал",Windows RO',
      ),
    );
    expect(again.map((r) => [r.result, r.changes])).toEqual([
      ['update', ['address']],
      ['unchanged', undefined],
    ]);
    expect(applyImport(s, again).updated).toHaveLength(1);
    expect(s.fleet.hosts().find((h) => h.name === 'msk-app-01')!.address).toBe('10.10.1.99');
  });

  it('takes a port with the address; a changed port is an address change', () => {
    const s = storage();
    applyImport(s, planImport(s, importRows('srv-01,10.0.0.1:2026,"Москва, ЦОД",Linux SSH')));
    expect(s.fleet.hosts()[0]).toMatchObject({ address: '10.0.0.1', port: 2026 });
    const plan = planImport(
      s,
      importRows('srv-01,10.0.0.1:2026,"Москва, ЦОД",Linux SSH\nsrv-02,10.0.0.2:ssh,Lab,Linux SSH'),
    );
    expect(plan.map((r) => r.result)).toEqual(['unchanged', 'error']);
    expect(plan[1]!.reason).toMatch(/port .* must be a number/);
    const [changed] = planImport(s, importRows('srv-01,10.0.0.1,"Москва, ЦОД",Linux SSH'));
    expect(changed).toMatchObject({ result: 'update', changes: ['address'] });
    applyImport(s, [changed!]);
    expect(s.fleet.hosts()[0]).toMatchObject({ address: '10.0.0.1', port: null });
  });

  it('refuses a profile of another kind than the host', () => {
    const s = storage();
    applyImport(s, planImport(s, importRows('srv-01,10.0.0.1,"Москва, ЦОД",Linux SSH')));
    const [row] = planImport(s, importRows('srv-01,10.0.0.1,"Москва, ЦОД",Windows RO'));
    expect(row).toMatchObject({
      result: 'error',
      reason: '"srv-01" is a ssh-linux host; profile "Windows RO" is for windows',
    });
  });
});
