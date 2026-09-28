// Demo fleet (`VD_DEMO=1`, docs/specs/fleet-ui.md §10): fills an empty instance with the design's 31 hosts, their
// sites, access profiles, versions, poll problems and history. The fixture uses the prototype's short ids; they are
// mapped to module ids and track ids here.
import type { FleetStore, HostKind } from './fleet.ts';
import type { BoardStore } from './store.ts';

export interface FleetDemo {
  sites: { id: string; name: string }[];
  accessProfiles: { id: string; name: string; type: string; user: string }[];
  hosts: {
    id: string;
    site: string;
    address: string;
    kind: string;
    accessProfile: string;
    poll: { state: string; since: string | null; lastAttempt: string };
    products: { product: string; version: string; line: string; label?: string }[];
    history: { at: string; text: string }[];
  }[];
}

const PRODUCT: Record<string, string> = {
  windows: 'windows-server',
  pve: 'proxmox-ve',
  pbs: 'proxmox-backup-server',
  docker: 'docker-engine',
};
const TRACK: Record<string, string> = { '7s': '7-stable', '7lt': '7-long-term', '6lt': '6-long-term' };
const KIND: Record<string, HostKind> = {
  linux: 'ssh-linux',
  windows: 'windows',
  mikrotik: 'routeros',
  proxmox: 'proxmox',
  pve: 'proxmox',
  pbs: 'proxmox',
};

/** "25.09.2026" or "26.09.2026 14:10" in the demo's time zone (+07:00) → ISO 8601 UTC. */
function demoTime(text: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(text);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '12'}:${m[5] ?? '00'}:00+07:00` : text;
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const hoursBefore = (iso: string, hours: number) =>
  new Date(Date.parse(iso) - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Seeds the demo into an instance without hosts; returns false (and does nothing) when hosts already exist. */
export function seedFleetDemo(stores: { store: BoardStore; fleet: FleetStore }, demo: FleetDemo): boolean {
  const { store, fleet } = stores;
  if (fleet.hosts().length > 0) return false;

  const existing = store.boards();
  const sites = new Map<string, number>();
  for (const site of demo.sites)
    sites.set(site.id, (existing.find((b) => b.name === site.name) ?? store.createBoard(site.name)).id);
  // The default "Main" board has nothing on it in a fresh instance: the demo's sites replace it.
  for (const board of existing)
    if (![...sites.values()].includes(board.id) && (store.items(board.id) ?? []).length === 0)
      store.deleteBoard(board.id);

  const profiles = new Map<string, number>();
  for (const p of demo.accessProfiles)
    profiles.set(
      p.id,
      fleet.createProfile({
        name: p.name,
        kind: KIND[p.type] ?? 'ssh-linux',
        username: p.user,
        secret: 'demo',
      }).id,
    );

  for (const h of demo.hosts) {
    const host = fleet.createHost({
      name: h.id,
      address: h.address,
      kind: KIND[h.kind] ?? 'ssh-linux',
      siteId: sites.get(h.site)!,
      profileId: profiles.get(h.accessProfile) ?? null,
    });
    const lastAttempt = new Date(h.poll.lastAttempt).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const failedSince = h.poll.state === 'ok' || !h.poll.since ? undefined : demoTime(h.poll.since);
    fleet.recordPoll(host.id, {
      ok: true,
      at: failedSince ? hoursBefore(failedSince, 6) : lastAttempt,
      found: h.products.map((p) => ({
        productId: PRODUCT[p.product] ?? p.product,
        version: p.version,
        track: TRACK[p.line] ?? p.line,
        ...(p.label && { label: p.label }),
      })),
    });
    const os = PRODUCT[h.products[0]!.product] ?? h.products[0]!.product;
    for (const event of h.history) {
      const change = /(\S+) → (\S+)$/.exec(event.text);
      if (change)
        fleet.addEvent(host.id, {
          at: demoTime(event.at),
          kind: 'version',
          productId: os,
          fromVersion: change[1]!,
          toVersion: change[2]!,
          message: null,
        });
    }
    if (failedSince) {
      const denied = h.poll.state === 'denied';
      const message =
        h.history.find((e) => !/→/.test(e.text))?.text ?? (denied ? 'Access denied' : 'No answer');
      const failure = {
        ok: false as const,
        state: denied ? ('auth-failed' as const) : ('unreachable' as const),
        code: denied ? 'password_expired' : 'timeout',
        message,
      };
      fleet.recordPoll(host.id, { ...failure, at: failedSince });
      fleet.recordPoll(host.id, { ...failure, at: lastAttempt });
    }
  }
  return true;
}
