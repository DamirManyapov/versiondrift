// GitOps-friendly inventory (docs/07): /data/inventory.yaml (VD_INVENTORY_FILE) defines boards; the server imports
// it at start and whenever its content changes. Boards the file names are replaced by it; others stay as they are.
// Edits in the UI last until the file changes again.
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Inventory, inventoryEntries } from '@versiondrift/schema';
import { parse as parseYaml } from 'yaml';
import { env } from '$env/dynamic/private';
import { selfHostedStorage } from './storage.ts';

const HASH_KEY = 'inventoryFileHash';

export const inventoryFile = () =>
  path.resolve(env.VD_INVENTORY_FILE || path.join(env.VD_DATA_DIR || './data', 'inventory.yaml'));

/** Imports the file if its content changed since the last import; returns what was imported, or undefined. */
export async function importInventoryFile(
  file = inventoryFile(),
): Promise<{ boards: string[]; items: number } | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return undefined; // no file: nothing is managed by it
  }
  const { store } = selfHostedStorage();
  const hash = createHash('sha256').update(text).digest('hex');
  if (store.settings()[HASH_KEY] === hash) return undefined;
  const result = Inventory.safeParse(parseYaml(text));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${path.basename(file)}: ${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`);
  }
  const byBoard = new Map<string, { p: string; ver: string; track?: string; label?: string }[]>();
  for (const entry of inventoryEntries(result.data)) {
    const items = byBoard.get(entry.board) ?? [];
    for (const instance of entry.instances)
      items.push({
        p: entry.productId,
        ver: instance.version,
        ...(instance.track && { track: instance.track }),
        ...((instance.label ?? instance.host) && { label: (instance.label ?? instance.host)! }),
      });
    byBoard.set(entry.board, items);
  }
  let count = 0;
  for (const [name, items] of byBoard) {
    const board =
      store.boards().find((b) => b.name.toLowerCase() === name.toLowerCase()) ?? store.createBoard(name);
    store.replaceItems(board.id, items);
    count += items.length;
  }
  store.setSettings({ [HASH_KEY]: hash });
  return { boards: [...byBoard.keys()], items: count };
}

let watching = false;

/** Imports now, then on every change (fs.watch, with a one-minute poll for mounts that don't report changes). */
export function watchInventoryFile(log: (line: string) => void = console.log): void {
  if (watching) return;
  watching = true;
  const file = inventoryFile();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () =>
    importInventoryFile(file)
      .then((done) => {
        if (done)
          log(`VersionDrift: imported ${done.items} product(s) into ${done.boards.join(', ')} from ${file}`);
      })
      .catch((error: unknown) =>
        log(`VersionDrift: ${(error as Error).message} — the boards were not changed`),
      );
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 500);
  };
  void run();
  try {
    watch(path.dirname(file), (_, name) => {
      if (name === path.basename(file)) soon();
    }).unref();
  } catch {
    // the directory may not exist yet; the poll covers it
  }
  setInterval(() => void run(), 60_000).unref();
}
