import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createSealer, openStorage, StoreError } from '../src/index.ts';

const telegram = {
  name: 'Ops chat',
  kind: 'telegram' as const,
  config: { token: '123:secret-token', chatId: '-100' },
  events: ['critical' as const, 'eol' as const],
  lang: 'ru' as const,
  digestDay: 1,
};

describe('sealing', () => {
  it('round-trips and refuses a different key or tampered data', () => {
    const a = createSealer('key one');
    const sealed = a.seal('{"token":"x"}');
    expect(a.open(sealed)).toBe('{"token":"x"}');
    expect(a.seal('{"token":"x"}')).not.toBe(sealed);
    expect(() => createSealer('key two').open(sealed)).toThrow(StoreError);
    const [v, iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0]! ^= 1;
    expect(() => a.open([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow(StoreError);
  });
});

describe('ChannelStore', () => {
  it('stores channels with sealed credentials', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'vd-ch-')), 'vd.db');
    const storage = openStorage(file, { secret: 'instance secret' });
    const created = storage.channels.create(telegram);
    expect(created).toMatchObject({ ...telegram, enabled: true, state: null, lastError: null });
    storage.close();
    const raw = new Database(file).prepare('SELECT config FROM channels').get() as { config: string };
    expect(raw.config).not.toContain('secret-token');
    const again = openStorage(file, { secret: 'instance secret' });
    expect(again.channels.get(created.id)?.config).toEqual(telegram.config);
    again.close();
  });

  it('updates settings without losing state, records runs, deletes', () => {
    const { channels } = openStorage(':memory:');
    const { id } = channels.create(telegram);
    channels.recordRun(id, { state: { version: 1, instances: {} }, at: '2026-09-26T03:00:00Z', sent: 1 });
    channels.recordRun(id, { state: { version: 1, instances: {} }, at: '2026-09-27T03:00:00Z', sent: 0 });
    channels.update(id, { events: ['critical', 'update', 'digest'], enabled: false });
    expect(channels.get(id)).toMatchObject({
      events: ['critical', 'update', 'digest'],
      enabled: false,
      state: { version: 1, instances: {} },
      lastSentAt: '2026-09-26T03:00:00Z',
    });
    channels.recordRun(id, { error: 'HTTP 401' });
    expect(channels.get(id)).toMatchObject({ lastError: 'HTTP 401', state: { version: 1, instances: {} } });
    expect(() => channels.update(id, { name: ' ' })).toThrow(StoreError);
    channels.remove(id);
    expect(channels.list()).toEqual([]);
    expect(() => channels.remove(id)).toThrow(StoreError);
  });
});
