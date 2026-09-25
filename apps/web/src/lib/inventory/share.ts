// Share links (docs/06 "Share link"): /b#s=<base64url(deflate-raw(JSON items))>, or the readable
// /b#grafana@11.3.1,poste-io@2.4.5 when that is shorter. The fragment never reaches the server.
// Labels are left out unless asked for: they often name internal hosts.
import { sanitize, type InventoryItem } from './model.ts';

/** Limits against hostile links: decoded JSON size and item count. */
const MAX_JSON = 256 * 1024;
const MAX_ITEMS = 500;
const ID = /^[a-z0-9][a-z0-9-]*$/;

export class ShareDecodeError extends Error {
  override name = 'ShareDecodeError';
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_JSON) {
      await reader.cancel();
      throw new ShareDecodeError('share link too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function shared(items: InventoryItem[], labels: boolean): InventoryItem[] {
  return items.map((i) => ({
    p: i.p,
    ...(i.ver && { ver: i.ver }),
    ...(i.track && { track: i.track }),
    ...(labels && i.label && { label: i.label }),
  }));
}

/** "grafana@11.3.1,debian" — only possible without tracks and labels, and with versions free of "," and "@". */
function readable(items: InventoryItem[]): string | undefined {
  if (items.some((i) => i.track || i.label || /[,@\s#]/.test(i.ver ?? ''))) return undefined;
  return items.map((i) => (i.ver ? `${i.p}@${i.ver}` : i.p)).join(',');
}

/** The fragment (without "#") for a board; the shorter of the readable and the compressed form. */
export async function encodeShare(
  items: InventoryItem[],
  options: { labels?: boolean } = {},
): Promise<string> {
  const list = shared(items, options.labels ?? false);
  const bytes = await pipe(
    new TextEncoder().encode(JSON.stringify(list)),
    new CompressionStream('deflate-raw'),
  );
  const packed = `s=${toBase64Url(bytes)}`;
  const plain = readable(list);
  return plain !== undefined && plain.length <= packed.length ? plain : packed;
}

/** Reads a fragment made by encodeShare (or typed by hand); throws ShareDecodeError when it is unusable. */
export async function decodeShare(fragment: string): Promise<InventoryItem[]> {
  const hash = fragment.replace(/^#/, '').trim();
  if (hash === '') throw new ShareDecodeError('empty share link');
  let raw: unknown[];
  if (hash.startsWith('s=')) {
    try {
      const bytes = await pipe(fromBase64Url(hash.slice(2)), new DecompressionStream('deflate-raw'));
      raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown[];
    } catch (error) {
      if (error instanceof ShareDecodeError) throw error;
      throw new ShareDecodeError('share link is damaged');
    }
    if (!Array.isArray(raw)) throw new ShareDecodeError('share link is damaged');
  } else {
    raw = decodeURIComponent(hash)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf('@');
        return at < 0 ? { p: part } : { p: part.slice(0, at), ver: part.slice(at + 1) };
      });
  }
  const items = sanitize({ items: raw.slice(0, MAX_ITEMS) }).items.filter((i) => ID.test(i.p));
  if (items.length === 0) throw new ShareDecodeError('no products in the share link');
  return items;
}

/** Adds shared items that the board doesn't have yet (same product, version and label). */
export function mergeItems(board: InventoryItem[], incoming: InventoryItem[]): InventoryItem[] {
  const key = (i: InventoryItem) => `${i.p}\u0000${i.ver ?? ''}\u0000${i.label ?? ''}`;
  const seen = new Set(board.map(key));
  return [...board, ...incoming.filter((i) => !seen.has(key(i)) && Boolean(seen.add(key(i))))];
}
