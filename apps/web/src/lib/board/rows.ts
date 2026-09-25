// Board model (docs/06 "Board"): one row per product on the board, its instances with their statuses,
// sorted critical → eol → update → news → ok → stale, then by name.
import { computeStatus, DEFAULT_SETTINGS, type ProductStatus, type Status } from '@versiondrift/core';
import type { FeedIndex, FeedProduct } from '@versiondrift/schema';
import type { InventoryItem, InventorySettings } from '../inventory/model.ts';

export interface InstanceRow {
  /** Position in the inventory (for edits). */
  index: number;
  item: InventoryItem;
  status: ProductStatus;
}

export interface Row {
  id: string;
  name: string;
  category: string;
  /** False when the product is not in the feed (removed or misspelt). */
  known: boolean;
  product?: FeedProduct;
  instances: InstanceRow[];
  /** The instance that decides the tile: the worst one. */
  primary?: InstanceRow;
  status: Status;
  /** A release newer than the installed one came out in the last 7 days. */
  newThisWeek: boolean;
}

export const STATUS_RANK: Record<Status, number> = {
  critical: 0,
  eol: 1,
  update: 2,
  news: 3,
  ok: 4,
  stale: 5,
};
export type SummaryStatus = 'critical' | 'eol' | 'update' | 'ok';
export const SUMMARY_STATUSES: SummaryStatus[] = ['critical', 'eol', 'update', 'ok'];

const WEEK = 7 * 86_400_000;

export function buildRows(
  items: InventoryItem[],
  index: FeedIndex | undefined,
  products: Record<string, FeedProduct>,
  settings: InventorySettings,
  now: Date = new Date(),
): Row[] {
  const statusSettings = { ...DEFAULT_SETTINGS, criticalCvss: settings.criticalCvss };
  const groups = new Map<string, { index: number; item: InventoryItem }[]>();
  items.forEach((item, i) => {
    const list = groups.get(item.p) ?? [];
    list.push({ index: i, item });
    groups.set(item.p, list);
  });

  const rows: Row[] = [];
  for (const [id, group] of groups) {
    const entry = index?.products[id];
    const product = products[id];
    const instances: InstanceRow[] = product
      ? group.map(({ index: i, item }) => ({
          index: i,
          item,
          status: computeStatus(
            product,
            {
              productId: id,
              ...(item.ver && { version: item.ver }),
              ...(item.track && { track: item.track }),
            },
            statusSettings,
            now,
          ),
        }))
      : [];
    const primary = [...instances].sort(
      (a, b) => STATUS_RANK[a.status.status] - STATUS_RANK[b.status.status],
    )[0];
    rows.push({
      id,
      name: entry?.name ?? product?.name ?? id,
      category: entry?.category ?? 'other',
      known: index === undefined || entry !== undefined,
      ...(product && { product }),
      instances,
      ...(primary && { primary }),
      status: primary?.status.status ?? 'news',
      newThisWeek: instances.some((inst) =>
        inst.status.newer.some((r) => now.getTime() - Date.parse(r.date ?? r.firstSeenAt) <= WEEK),
      ),
    });
  }
  return rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name));
}

export interface BoardFilter {
  status?: SummaryStatus;
  category?: string;
  query: string;
  hideOk: boolean;
}

export function filterRows(rows: Row[], filter: BoardFilter): Row[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filter.status === undefined || row.status === filter.status) &&
      (filter.category === undefined || row.category === filter.category) &&
      (!filter.hideOk || filter.status === 'ok' || row.status !== 'ok') &&
      (query === '' || row.name.toLowerCase().includes(query) || row.id.includes(query)),
  );
}

export function summarize(rows: Row[]): Record<SummaryStatus, number> {
  const counts: Record<SummaryStatus, number> = { critical: 0, eol: 0, update: 0, ok: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status as SummaryStatus]++;
  return counts;
}
