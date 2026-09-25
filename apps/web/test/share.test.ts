import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, mergeItems, ShareDecodeError } from '../src/lib/inventory/share.ts';

describe('share links', () => {
  it('uses the readable form for simple boards', async () => {
    const fragment = await encodeShare([{ p: 'grafana', ver: '11.3.1' }, { p: 'debian' }]);
    expect(fragment).toBe('grafana@11.3.1,debian');
    expect(await decodeShare(`#${fragment}`)).toEqual([{ p: 'grafana', ver: '11.3.1' }, { p: 'debian' }]);
  });

  it('compresses boards with tracks, and round-trips them', async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ p: `product-${i}`, ver: `1.${i}.0`, track: '1' }));
    const fragment = await encodeShare(items);
    expect(fragment).toMatch(/^s=[A-Za-z0-9_-]+$/);
    expect(await decodeShare(fragment)).toEqual(items);
  });

  it('leaves labels out unless asked', async () => {
    const items = [{ p: 'grafana', ver: '11.3.1', label: 'mon-01.corp.local' }];
    expect(await decodeShare(await encodeShare(items))).toEqual([{ p: 'grafana', ver: '11.3.1' }]);
    expect(await decodeShare(await encodeShare(items, { labels: true }))).toEqual(items);
  });

  it('keeps versions with "+" and "~" readable, compresses ones with "@"', async () => {
    expect(await encodeShare([{ p: 'k3s', ver: '1.37.0+k3s1' }])).toBe('k3s@1.37.0+k3s1');
    const odd = [{ p: 'x', ver: 'a@b' }];
    expect(await encodeShare(odd)).toMatch(/^s=/);
    expect(await decodeShare(await encodeShare(odd))).toEqual(odd);
  });

  it('rejects damaged, empty and hostile links', async () => {
    await expect(decodeShare('')).rejects.toBeInstanceOf(ShareDecodeError);
    await expect(decodeShare('s=not-deflate')).rejects.toBeInstanceOf(ShareDecodeError);
    await expect(decodeShare('<script>@1')).rejects.toBeInstanceOf(ShareDecodeError);
    const huge = await encodeShare(
      Array.from({ length: 20_000 }, (_, i) => ({ p: 'a', ver: String(i), track: 't' })),
    );
    await expect(decodeShare(huge)).rejects.toThrow(/too large/);
  });

  it('merges without duplicates', () => {
    const board = [{ p: 'grafana', ver: '11.3.1' }];
    expect(
      mergeItems(board, [
        { p: 'grafana', ver: '11.3.1' },
        { p: 'grafana', ver: '12.0.0' },
      ]),
    ).toEqual([
      { p: 'grafana', ver: '11.3.1' },
      { p: 'grafana', ver: '12.0.0' },
    ]);
  });
});
