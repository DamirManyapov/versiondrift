// The anonymous board's inventory (docs/06 "Inventory storage"): what the user runs, kept only in the browser.
// YAML import/export uses the self-hosted inventory.yaml format, so one file works for the site, notify and Docker.
import { Inventory, inventoryEntries, type InstanceSpec } from '@versiondrift/schema';
import { parse as parseYaml, stringify as toYamlText } from 'yaml';

export interface InventoryItem {
  /** Product id. */
  p: string;
  /** Installed version; absent = "news" (tile shows recent releases only). */
  ver?: string;
  track?: string;
  /** Tells instances of one product apart ("prod", "mon-01"). */
  label?: string;
}

export interface InventorySettings {
  criticalCvss: number;
  hideOk: boolean;
}

export interface InventoryData {
  v: 1;
  items: InventoryItem[];
  settings: InventorySettings;
}

export const DEFAULT_SETTINGS: InventorySettings = { criticalCvss: 7, hideOk: false };

/** Shown on the first visit (docs/06: "Try it: this is a sample stack"); not saved until the user edits it. */
export const DEMO_ITEMS: InventoryItem[] = [
  { p: 'grafana', ver: '12.4.5' },
  { p: 'zabbix', ver: '7.0.20' },
  { p: 'proxmox-ve', ver: '8.4' },
  { p: 'debian', ver: '12.15' },
  { p: 'postgresql', ver: '16.15' },
  { p: 'nginx', ver: '1.30.1' },
  { p: 'poste-io', ver: '2.5.15' },
  { p: 'elasticsearch', ver: '8.19.20' },
  { p: 'routeros', ver: '7.24.4' },
];
export const emptyInventory = (): InventoryData => ({ v: 1, items: [], settings: { ...DEFAULT_SETTINGS } });

/** Repairs anything read from storage: unknown shapes become an empty inventory, bad items are dropped. */
export function sanitize(value: unknown): InventoryData {
  const data = emptyInventory();
  if (typeof value !== 'object' || value === null) return data;
  const raw = value as { items?: unknown; settings?: Partial<InventorySettings> };
  if (Array.isArray(raw.items)) {
    for (const item of raw.items as Partial<InventoryItem>[]) {
      if (typeof item?.p !== 'string' || item.p === '') continue;
      data.items.push({
        p: item.p,
        ...(typeof item.ver === 'string' && item.ver !== '' && { ver: item.ver }),
        ...(typeof item.track === 'string' && { track: item.track }),
        ...(typeof item.label === 'string' && item.label !== '' && { label: item.label }),
      });
    }
  }
  const cvss = raw.settings?.criticalCvss;
  if (typeof cvss === 'number' && cvss >= 0 && cvss <= 10) data.settings.criticalCvss = cvss;
  if (typeof raw.settings?.hideOk === 'boolean') data.settings.hideOk = raw.settings.hideOk;
  return data;
}

export function addProduct(data: InventoryData, p: string, ver?: string): InventoryData {
  if (data.items.some((i) => i.p === p && i.label === undefined && (ver === undefined || i.ver === ver)))
    return data;
  return { ...data, items: [...data.items, { p, ...(ver && { ver }) }] };
}

export function updateItem(
  data: InventoryData,
  index: number,
  patch: Partial<Omit<InventoryItem, 'p'>>,
): InventoryData {
  const items = data.items.map((item, i) => {
    if (i !== index) return item;
    const next: InventoryItem = { ...item, ...patch };
    for (const key of ['ver', 'track', 'label'] as const)
      if (next[key] === undefined || next[key] === '') delete next[key];
    return next;
  });
  return { ...data, items };
}

export const removeItem = (data: InventoryData, index: number): InventoryData => ({
  ...data,
  items: data.items.filter((_, i) => i !== index),
});

/** inventory.yaml with one board, "main". Products followed without a version are left out: the format needs one. */
export function toYaml(data: InventoryData): string {
  const products: Record<string, InstanceSpec[]> = {};
  for (const item of data.items) {
    if (!item.ver) continue;
    (products[item.p] ??= []).push({
      version: item.ver,
      ...(item.track && { track: item.track }),
      ...(item.label && { label: item.label }),
    });
  }
  const body = toYamlText(
    { boards: { main: { products } } },
    { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' },
  );
  return `# VersionDrift inventory — also works with self-hosted and \`pnpm notify\`\n${body}`;
}

export class InventoryImportError extends Error {
  override name = 'InventoryImportError';
}

/** Reads inventory.yaml (every board is merged into the one browser board). */
export function fromYaml(text: string): InventoryItem[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new InventoryImportError(`not valid YAML: ${(error as Error).message.split('\n')[0]}`);
  }
  const result = Inventory.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InventoryImportError(
      `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid inventory'}`,
    );
  }
  return inventoryEntries(result.data).flatMap((entry) =>
    entry.instances.map((instance) => ({
      p: entry.productId,
      ver: instance.version,
      ...(instance.track && { track: instance.track }),
      ...((instance.label ?? instance.host) && { label: instance.label ?? instance.host }),
    })),
  );
}
