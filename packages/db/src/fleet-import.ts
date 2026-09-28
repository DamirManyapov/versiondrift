// Adding hosts from a list (docs/specs/fleet-ui.md §5.D): CSV `name,address,site,profile[,kind]`, a dry run that says
// per line what would happen, then the import. It is an upsert by host name: existing hosts are "unchanged" or
// "update" (address, site, profile), new sites are created, unknown profiles are errors.
import type { AccessProfile, FleetStore, HostKind } from './fleet.ts';
import * as schema from './schema.ts';
import { StoreError, type BoardStore } from './store.ts';

export interface ImportRow {
  line: number;
  name: string;
  address: string;
  site: string;
  profile: string;
  kind?: string;
}

export interface ImportPlanRow extends ImportRow {
  result: 'new' | 'unchanged' | 'update' | 'error';
  /** What changes for an update, or why a line is an error. */
  reason?: string;
  changes?: ('address' | 'site' | 'profile')[];
  newSite?: boolean;
}

/** RFC 4180-ish: commas, double-quoted fields with "" escapes, CRLF or LF; blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** CSV lines as rows, with their line numbers; a first line "name,address,…" is a header. */
export function importRows(text: string): ImportRow[] {
  const lines = parseCsv(text);
  const header = lines[0]?.[0]?.trim().toLowerCase() === 'name';
  return lines.slice(header ? 1 : 0).map((cells, i) => ({
    line: i + (header ? 2 : 1),
    name: (cells[0] ?? '').trim(),
    address: (cells[1] ?? '').trim(),
    site: (cells[2] ?? '').trim(),
    profile: (cells[3] ?? '').trim(),
    ...(cells[4]?.trim() && { kind: cells[4].trim() }),
  }));
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** What an import would do, line by line; nothing is written. */
export function planImport(
  stores: { store: BoardStore; fleet: FleetStore },
  rows: ImportRow[],
): ImportPlanRow[] {
  const sites = new Map(stores.store.boards().map((b) => [b.name.toLowerCase(), b.id]));
  const profiles = new Map(stores.fleet.profiles().map((p) => [p.name.toLowerCase(), p]));
  const hosts = new Map(stores.fleet.hosts().map((h) => [h.name.toLowerCase(), h]));
  const seen = new Set<string>();
  return rows.map((row): ImportPlanRow => {
    const error = (reason: string): ImportPlanRow => ({ ...row, result: 'error', reason });
    if (!NAME.test(row.name)) return error(row.name ? `"${row.name}" is not a host name` : 'no host name');
    if (seen.has(row.name.toLowerCase())) return error(`"${row.name}" appears twice in the list`);
    seen.add(row.name.toLowerCase());
    if (!row.address) return error('no address');
    if (!row.site) return error('no site');
    let profile: AccessProfile | undefined;
    if (row.profile) {
      profile = profiles.get(row.profile.toLowerCase());
      if (!profile) return error(`no access profile "${row.profile}"`);
    } else if (!row.kind || !(schema.HOST_KINDS as readonly string[]).includes(row.kind))
      return error(`without a profile, give the type: ${schema.HOST_KINDS.join(', ')}`);
    if (profile && row.kind && row.kind !== profile.kind)
      return error(`profile "${profile.name}" is for ${profile.kind} hosts, not ${row.kind}`);
    const siteId = sites.get(row.site.toLowerCase());
    const newSite = siteId === undefined;
    const existing = hosts.get(row.name.toLowerCase());
    if (!existing) return { ...row, result: 'new', ...(newSite && { newSite }) };
    const changes: ('address' | 'site' | 'profile')[] = [];
    if (existing.address !== row.address) changes.push('address');
    if (existing.siteId !== siteId) changes.push('site');
    if (existing.profileId !== (profile?.id ?? null)) changes.push('profile');
    if (profile && existing.kind !== profile.kind)
      return error(
        `"${row.name}" is a ${existing.kind} host; profile "${profile.name}" is for ${profile.kind}`,
      );
    return changes.length
      ? { ...row, result: 'update', changes, ...(newSite && { newSite }) }
      : { ...row, result: 'unchanged' };
  });
}

/** Applies a plan's new and update rows (errors and unchanged rows are skipped); returns the hosts touched. */
export function applyImport(
  stores: { store: BoardStore; fleet: FleetStore },
  plan: ImportPlanRow[],
): { created: number[]; updated: number[] } {
  const { store, fleet } = stores;
  const siteId = (name: string) =>
    store.boards().find((b) => b.name.toLowerCase() === name.toLowerCase())?.id ?? store.createBoard(name).id;
  const profile = (name: string) => fleet.profiles().find((p) => p.name.toLowerCase() === name.toLowerCase());
  const created: number[] = [];
  const updated: number[] = [];
  for (const row of plan) {
    if (row.result !== 'new' && row.result !== 'update') continue;
    const p = row.profile ? profile(row.profile) : undefined;
    if (row.profile && !p) throw new StoreError(`no access profile "${row.profile}"`);
    if (row.result === 'new') {
      created.push(
        fleet.createHost({
          name: row.name,
          address: row.address,
          siteId: siteId(row.site),
          kind: p?.kind ?? (row.kind as HostKind),
          profileId: p?.id ?? null,
        }).id,
      );
      continue;
    }
    const host = fleet.hosts().find((h) => h.name.toLowerCase() === row.name.toLowerCase())!;
    if (row.changes?.includes('address')) fleet.setAddress(host.id, row.address);
    if (row.changes?.includes('site')) fleet.moveHosts([host.id], siteId(row.site));
    if (row.changes?.includes('profile')) fleet.setProfile([host.id], p?.id ?? null);
    updated.push(host.id);
  }
  return { created, updated };
}
