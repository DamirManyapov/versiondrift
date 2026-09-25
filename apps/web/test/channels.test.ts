import type { ChannelRecord } from '@versiondrift/db';
import { describe, expect, it } from 'vitest';
import { parseNew, parsePatch, redact } from '../src/lib/server/channels.ts';

const base = { name: 'Ops', events: ['critical'], lang: 'en', digestDay: 1 };
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { status?: number; body?: { message?: string } }).body?.message ?? String(e);
  }
  return 'ok';
};

describe('channel API input', () => {
  it('validates settings per kind and drops empty optional fields', () => {
    expect(parseNew({ ...base, kind: 'ntfy', config: { server: '', topic: 'stack', token: '' } })).toEqual({
      ...base,
      kind: 'ntfy',
      config: { topic: 'stack' },
    });
    expect(
      status(() => parseNew({ ...base, kind: 'gotify', config: { server: 'ftp://x', token: 't' } })),
    ).toMatch(/^config\.server/);
    expect(status(() => parseNew({ ...base, kind: 'sms', config: {} }))).not.toBe('ok');
    expect(
      status(() =>
        parseNew({ ...base, events: ['everything'], kind: 'webhook', config: { url: 'https://h' } }),
      ),
    ).toMatch(/^events/);
    expect(
      parseNew({
        ...base,
        kind: 'email',
        config: { host: 'smtp', port: '587', secure: false, from: 'a@b', to: 'c@d' },
      }).config,
    ).toMatchObject({ port: 587 });
  });

  const current: ChannelRecord = {
    id: 1,
    name: 'Ops',
    kind: 'telegram',
    config: { token: 'tok-3f9', chatId: '-100' },
    events: ['critical'],
    lang: 'en',
    digestDay: 1,
    enabled: true,
    state: null,
    lastSentAt: null,
    lastError: null,
  };

  it('keeps a stored secret when the edit leaves it empty', () => {
    expect(parsePatch({ config: { token: '', chatId: '-200' } }, current).config).toEqual({
      token: 'tok-3f9',
      chatId: '-200',
    });
    expect(parsePatch({ config: { token: 'new', chatId: '-200' } }, current).config).toEqual({
      token: 'new',
      chatId: '-200',
    });
    expect(parsePatch({ enabled: false }, current)).toEqual({ enabled: false });
  });

  it('never returns credentials', () => {
    const shown = redact(current);
    expect(JSON.stringify(shown)).not.toContain('tok-3f9');
    expect(shown).toMatchObject({ config: { chatId: '-100' }, secrets: ['token'] });
  });
});
