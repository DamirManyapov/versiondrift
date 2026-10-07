// Products followed without a host on the fleet board (docs/07): with a site chosen, that site's board (the open
// one in the inventory state, editable); under "All sites", every site's from the fleet answer, read-only, each
// labelled with its site. Shared by the grid ("Without a host") and the board's one detail panel.
import type { InventoryItem } from '$lib/inventory/model';
import type { FleetData } from './api.ts';

export interface HostlessView {
  items: InventoryItem[];
  /** The chosen site's board is open, so its items can be changed. */
  editable: boolean;
  /** Every site's items (shown under "All sites"); the section shows when there are any or a site is chosen. */
  all: InventoryItem[];
}

export function hostlessView(
  data: FleetData,
  site: number | undefined,
  open: { loaded: boolean; boardId: number | undefined; items: InventoryItem[] },
): HostlessView {
  const siteName = (id: number) => data.sites.find((s) => s.id === id)?.name ?? '';
  const all = data.hostless.flatMap((s) =>
    s.items.map((item) => ({
      ...item,
      label: item.label ? `${siteName(s.siteId)} · ${item.label}` : siteName(s.siteId),
    })),
  );
  const editable = site !== undefined && open.loaded && open.boardId === site;
  return { items: site === undefined ? all : editable ? open.items : [], editable, all };
}
