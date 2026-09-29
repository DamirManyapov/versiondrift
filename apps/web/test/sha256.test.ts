import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256Js } from '../src/lib/feed/sha256.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const node = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('sha256 without WebCrypto (plain-http pages)', () => {
  it('matches node:crypto across block boundaries and on UTF-8 text', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 256);
      expect(hex(sha256Js(bytes)), `length ${length}`).toBe(node(bytes));
    }
    const text = new TextEncoder().encode('Фид VersionDrift ✓ — 13.7');
    expect(hex(sha256Js(text))).toBe(node(text));
    expect(hex(sha256Js(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sha256Hex gives the same answer with and without crypto.subtle', async () => {
    const text = JSON.stringify({ id: 'debian', releases: ['13.7', '13.6'] });
    const withSubtle = await sha256Hex(text);
    const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      expect(await sha256Hex(text)).toBe(withSubtle);
    } finally {
      if (subtle) Object.defineProperty(globalThis.crypto, 'subtle', subtle);
      else Reflect.deleteProperty(globalThis.crypto, 'subtle');
    }
    expect(withSubtle).toBe(createHash('sha256').update(text).digest('hex'));
  });
});
