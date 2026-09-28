// From the fleet API and the feed to what the screens show: each host's products with their version status
// (core.fleetInstance), the host status and the per-product aggregates (docs/specs/fleet-ui.md §4).
import {
  DEFAULT_SETTINGS,
  fleetAggregates,
  fleetInstance,
  hostStatus,
  type FleetHost,
  type FleetInstance,
  type HostStatus,
  type ProductAggregate,
  type StatusSettings,
} from '@versiondrift/core';
import type { FeedProduct } from '@versiondrift/schema';
import type { FleetData, HostRecord } from './api.ts';

export interface FleetHostView extends FleetHost {
  record: HostRecord;
  siteName: string;
  status: HostStatus;
}

/** An instance whose product the feed doesn't know (or hasn't loaded yet) has an unknown status. */
function unplaced(productId: string, version: string, source: FleetInstance['source']): FleetInstance {
  return {
    productId,
    version,
    status: 'unknown',
    track: null,
    latest: null,
    behind: 0,
    advisories: 0,
    exploited: 0,
    sortKey: null,
    source,
  };
}

export function fleetView(
  data: FleetData,
  products: Record<string, FeedProduct>,
  site: number | undefined,
  settings: StatusSettings = DEFAULT_SETTINGS,
  now: Date = new Date(),
): { hosts: FleetHostView[]; aggregates: ProductAggregate<FleetHostView>[] } {
  const sites = new Map(data.sites.map((s) => [s.id, s.name]));
  const hosts: FleetHostView[] = data.hosts
    .filter((h) => site === undefined || h.siteId === site)
    .map((record) => {
      const instances = record.instances.flatMap((i): FleetInstance[] => {
        if (!i.version) return [];
        const product = products[i.productId];
        return [
          product
            ? fleetInstance(
                product,
                { productId: i.productId, version: i.version, ...(i.track && { track: i.track }) },
                i.source,
                settings,
                now,
              )
            : unplaced(i.productId, i.version, i.source),
        ];
      });
      const host: FleetHost = {
        id: String(record.id),
        poll: { state: record.poll.state, since: record.poll.since },
        instances,
      };
      return { ...host, record, siteName: sites.get(record.siteId) ?? '', status: hostStatus(host) };
    });
  return { hosts, aggregates: fleetAggregates(hosts) };
}

/** Every product id on the fleet, to load their feed files. */
export const fleetProductIds = (data: FleetData): string[] => [
  ...new Set(data.hosts.flatMap((h) => h.instances.map((i) => i.productId))),
];
